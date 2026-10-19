/**
 * Thin REST client for Gemini transcription (Interactions API).
 *
 * Takes the API key as an argument and never reads env vars, so the same code
 * runs in the benchmark (Node) and the route handler. Only call it from server
 * code — never ship the key to the browser.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/transcribe
 */
import { z } from "zod";
import { parseOffset } from "./parse-offsets";
import type { Word } from "./types";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** Lightweight endpoint used to check a visitor's key without spending anything. */
export const GEMINI_MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_MODEL = "gemini-3.5-transcribe";
/** Gemini rejects requests above 20 MB total (base64 inflates audio by ~4/3). */
export const MAX_INLINE_AUDIO_BYTES = 14 * 1024 * 1024;

export type TranscribeOptions = {
  /** Word-level timestamps. Not allowed with `customVocabulary`. */
  timestamps?: boolean;
  /** Speaker labels. Not allowed with `customVocabulary`. */
  diarization?: boolean;
  /** Up to 1000 terms. Not allowed with timestamps or diarization. */
  customVocabulary?: string[];
};

export type TranscribeRequest = TranscribeOptions & {
  apiKey: string;
  audio: Uint8Array;
  /** e.g. "audio/ogg" */
  mimeType: string;
  model?: string;
  /** Let Google store the interaction (default false: 55-day retention on paid tier). */
  store?: boolean;
  /** Per-attempt timeout. Default 280 s (under Vercel's 300 s limit). */
  timeoutMs?: number;
  /** Total attempts for retryable failures (429 / 5xx / network). Default 3. */
  maxAttempts?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

export type TranscribeResult = {
  text: string;
  words: Word[];
  interactionId?: string;
  usage?: unknown;
  latencyMs: number;
  attempts: number;
  raw: unknown;
};

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    readonly body?: unknown,
    /** Seconds the API asked us to wait (Retry-After), if it sent one. */
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/**
 * Longest Retry-After we honour inside one request. Daily quota errors ask for
 * hours (e.g. free tier: "retry in 9h44m"); waiting would keep the browser
 * stuck on "Transcribing…" until its own timeout. Fail fast with the reason.
 */
export const MAX_RETRY_DELAY_MS = 30_000;

/** Retry-After is either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/** "45s", "9m 12s", "9h 44m" — for logs and error messages. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Log an upstream failure in a form that is easy to spot in `pnpm dev`. */
export function logUpstreamFailure(status: number | undefined, message: string, retryAfterSec?: number) {
  const text = message.length > 500 ? `${message.slice(0, 500)}…` : message;
  const wait = retryAfterSec !== undefined ? ` (retry after ${formatWait(retryAfterSec)})` : "";
  console.warn(`[gemini] request failed: ${status ?? "network"} — ${text}${wait}`);
}

export function buildTranscriptionBody(
  model: string,
  audioBase64: string,
  mimeType: string,
  opts: TranscribeOptions,
  store = false,
) {
  const vocab = opts.customVocabulary?.filter((t) => t.trim()) ?? [];
  if (vocab.length && (opts.timestamps || opts.diarization)) {
    throw new GeminiError(
      "custom_vocabulary cannot be combined with word timestamps or diarization (use two passes)",
    );
  }
  if (vocab.length > 1000) {
    throw new GeminiError(`custom_vocabulary allows at most 1000 terms (got ${vocab.length})`);
  }

  // Always verbatim: "smart" mode rewrites text, which breaks alignment and
  // can't be combined with timestamps anyway.
  const mode: Record<string, unknown> = { type: "verbatim" };
  if (opts.timestamps) mode.timestamp_granularities = ["word"];
  if (opts.diarization) mode.diarization_mode = "speaker";

  const transcription_config: Record<string, unknown> = { mode };
  if (vocab.length) transcription_config.custom_vocabulary = vocab;

  return {
    model,
    input: [{ type: "audio", data: audioBase64, mime_type: mimeType }],
    generation_config: { transcription_config },
    store,
  };
}

// ---------------------------------------------------------------------------
// Response parsing. Loose objects so unknown new fields don't break us, but
// word_info entries are checked strictly because the app depends on them.

const WordInfoSchema = z.object({
  type: z.literal("word_info"),
  text: z.string(),
  speaker: z.string().optional(),
  start_offset: z.string(),
  end_offset: z.string(),
});

const ContentSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  annotations: z.array(z.looseObject({ type: z.string() })).optional(),
});

const InteractionSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  output_text: z.string().optional(),
  steps: z
    .array(z.looseObject({ type: z.string().optional(), content: z.array(ContentSchema).optional() }))
    .optional(),
  usage: z.unknown().optional(),
});

export function parseInteraction(json: unknown): Omit<TranscribeResult, "latencyMs" | "attempts"> {
  const parsed = InteractionSchema.safeParse(json);
  if (!parsed.success) {
    throw new GeminiError(`Unexpected response shape: ${parsed.error.message}`, undefined, false, json);
  }
  const interaction = parsed.data;
  if (interaction.status && interaction.status !== "completed") {
    throw new GeminiError(`Interaction not completed (status: ${interaction.status})`, undefined, false, json);
  }

  const texts: string[] = [];
  const words: Word[] = [];
  for (const step of interaction.steps ?? []) {
    // Skip echoed user input; keep model output (and steps with no type).
    if (step.type && step.type !== "model_output") continue;
    for (const content of step.content ?? []) {
      if (content.type === "text" && content.text) texts.push(content.text);
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "word_info") continue;
        const w = WordInfoSchema.safeParse(annotation);
        if (!w.success) {
          throw new GeminiError(`Malformed word_info annotation: ${w.error.message}`, undefined, false, json);
        }
        words.push({
          text: w.data.text,
          start: parseOffset(w.data.start_offset),
          end: parseOffset(w.data.end_offset),
          ...(w.data.speaker ? { speaker: w.data.speaker } : {}),
        });
      }
    }
  }

  return {
    text: (interaction.output_text ?? texts.join("\n")).trim(),
    words,
    interactionId: interaction.id,
    usage: interaction.usage,
    raw: json,
  };
}

// ---------------------------------------------------------------------------

export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export async function transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
  if (req.audio.byteLength > MAX_INLINE_AUDIO_BYTES) {
    throw new GeminiError(
      `Audio is ${(req.audio.byteLength / 1e6).toFixed(1)} MB; inline limit is ${MAX_INLINE_AUDIO_BYTES / 1e6} MB. Use smaller chunks.`,
    );
  }
  const doFetch = req.fetch ?? globalThis.fetch;
  const body = JSON.stringify(
    buildTranscriptionBody(
      req.model ?? DEFAULT_MODEL,
      Buffer.from(req.audio).toString("base64"),
      req.mimeType,
      req,
      req.store ?? false,
    ),
  );
  const maxAttempts = req.maxAttempts ?? 3;
  const started = Date.now();

  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(req.timeoutMs ?? 280_000);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
        body,
        signal,
      });
    } catch (err) {
      if (timeout.aborted) throw new GeminiError("Gemini request timed out", undefined, true);
      if (req.signal?.aborted) throw err;
      // Network error: retry.
      console.warn(`[gemini] network error (attempt ${attempt}/${maxAttempts}): ${(err as Error).message}`);
      if (attempt >= maxAttempts) {
        throw new GeminiError(`Network error: ${(err as Error).message}`, undefined, true);
      }
      await sleep(backoffMs(attempt), req.signal);
      continue;
    }

    if (res.ok) {
      const json: unknown = await res.json();
      return { ...parseInteraction(json), latencyMs: Date.now() - started, attempts: attempt };
    }

    const errBody = await res.json().catch(() => undefined);
    const message =
      (errBody as { error?: { message?: string } } | undefined)?.error?.message ?? res.statusText;
    const retryable = RETRYABLE_STATUS.has(res.status);
    const retryAfterSec = parseRetryAfter(res.headers.get("retry-after"));
    logUpstreamFailure(res.status, message, retryAfterSec);
    const waitMs = retryAfterSec !== undefined ? retryAfterSec * 1000 : backoffMs(attempt);
    if (!retryable || attempt >= maxAttempts || waitMs > MAX_RETRY_DELAY_MS) {
      throw new GeminiError(`Gemini ${res.status}: ${message}`, res.status, retryable, errBody, retryAfterSec);
    }
    console.warn(
      `[gemini] retrying in ${formatWait(waitMs / 1000)} (attempt ${attempt + 1}/${maxAttempts})`,
    );
    await sleep(waitMs, req.signal);
  }
}

export function backoffMs(attempt: number) {
  return 1000 * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
}

export function sleep(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((r) => setTimeout(r, ms));
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------

export type KeyCheckResult = { ok: true; model: string } | { ok: false; error: string; status?: number };

/**
 * Verify a visitor's key by reading one model's metadata. Free and instant, and
 * it distinguishes a bad key (400/403) from a valid key with no quota (429).
 */
export async function checkApiKey(req: {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<KeyCheckResult> {
  const model = req.model ?? DEFAULT_MODEL;
  const doFetch = req.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(`${GEMINI_MODELS_ENDPOINT}/${encodeURIComponent(model)}`, {
      headers: { "x-goog-api-key": req.apiKey },
      signal: req.signal,
    });
  } catch (err) {
    return { ok: false, error: `Couldn't reach Gemini: ${(err as Error).message}` };
  }
  if (res.ok) return { ok: true, model };
  const body = await res.json().catch(() => undefined);
  const message = (body as { error?: { message?: string } } | undefined)?.error?.message ?? res.statusText;
  logUpstreamFailure(res.status, message, parseRetryAfter(res.headers.get("retry-after")));
  return { ok: false, status: res.status, error: message };
}
