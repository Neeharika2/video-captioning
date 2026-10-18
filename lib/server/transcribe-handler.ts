import "server-only";
import {
  LANGUAGE_CODE_RE,
  MAX_LANGUAGE_CODES,
  type ApiError,
  type ApiErrorCode,
  type TranscribeResponse,
} from "../api-types";
import { GeminiError, transcribe as geminiTranscribe } from "../gemini";
import { OggOpusError, oggOpusDuration } from "../ogg-duration";
import { getConfig, type ServerConfig } from "./config";
import { getQuotaStore, type QuotaStore } from "./quota";

export type HandlerDeps = {
  config?: ServerConfig;
  quota?: QuotaStore;
  transcribe?: typeof geminiTranscribe;
};

/**
 * POST /api/transcribe
 *
 * Body: one Ogg Opus chunk (Content-Type: audio/ogg), ≤ maxChunkSeconds.
 * Query: ?languages=te-IN,en-IN (optional BCP-47 hints).
 *
 * No auth for now: anyone who can reach the URL can call it. The app-wide
 * daily quota and rate limit cap Gemini spend.
 *
 * Stateless: returns chunk-local word timings; the browser stitches chunks.
 * Never logs audio or transcript text.
 */
/** Quota bucket shared by all callers until there are user accounts. */
const QUOTA_SUBJECT = "global";

export async function handleTranscribe(request: Request, deps: HandlerDeps = {}): Promise<Response> {
  const config = deps.config ?? getConfig();
  const started = Date.now();

  if (!config.geminiApiKey) return fail(500, "misconfigured", "Server misconfigured: GEMINI_API_KEY is not set");

  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "audio/ogg" && contentType !== "audio/opus") {
    return fail(415, "unsupported_media", "Send Ogg Opus audio with Content-Type: audio/ogg");
  }

  const url = new URL(request.url);
  const languages = (url.searchParams.get("languages") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (languages.length > MAX_LANGUAGE_CODES || languages.some((l) => !LANGUAGE_CODE_RE.test(l))) {
    return fail(400, "bad_request", "Invalid languages parameter");
  }

  const declared = Number(request.headers.get("content-length"));
  if (declared > config.maxUploadBytes) return tooLarge(config);
  const audio = await readLimited(request, config.maxUploadBytes);
  if (audio === "too_large") return tooLarge(config);
  if (!audio.byteLength) return fail(400, "bad_request", "Empty body");

  let durationSec: number;
  try {
    durationSec = oggOpusDuration(audio);
  } catch (err) {
    if (err instanceof OggOpusError) return fail(415, "unsupported_media", `Invalid audio: ${err.message}`);
    throw err;
  }
  // Small tolerance for encoder padding at chunk ends.
  if (durationSec > config.maxChunkSeconds + 2) {
    return fail(
      413,
      "too_long",
      `Chunk is ${Math.round(durationSec)} s; the limit is ${config.maxChunkSeconds} s per request`,
    );
  }

  const quota = deps.quota ?? getQuotaStore(config);
  const decision = await quota.reserve(QUOTA_SUBJECT, durationSec);
  if (!decision.ok) {
    return fail(
      429,
      decision.reason,
      decision.reason === "rate_limited"
        ? "Too many requests; slow down"
        : `Daily audio quota used (${Math.round((decision.usedSeconds ?? 0) / 60)} of ${Math.round((decision.limitSeconds ?? 0) / 60)} min)`,
      decision.reason === "rate_limited",
      decision.retryAfterSec,
    );
  }

  try {
    const result = await (deps.transcribe ?? geminiTranscribe)({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      audio,
      mimeType: "audio/ogg",
      timestamps: true,
      languageCodes: languages.length ? languages : undefined,
      signal: request.signal,
      // Leave headroom under the route's maxDuration for parsing + response.
      timeoutMs: 270_000,
      maxAttempts: 2,
    });
    log({ durationSec, status: 200, words: result.words.length, ms: Date.now() - started, attempts: result.attempts });
    const body: TranscribeResponse = {
      words: result.words,
      text: result.text,
      durationSec,
      model: config.geminiModel,
      quota: { usedSeconds: decision.usedSeconds, limitSeconds: decision.limitSeconds },
    };
    return Response.json(body);
  } catch (err) {
    await quota.refund(QUOTA_SUBJECT, durationSec).catch(() => {});
    const res = mapUpstreamError(err);
    log({ durationSec, status: res.status, ms: Date.now() - started, error: (err as Error).message });
    return res;
  }
}

function mapUpstreamError(err: unknown): Response {
  if (!(err instanceof GeminiError)) {
    if ((err as Error)?.name === "AbortError") return fail(499, "timeout", "Request aborted by client", true);
    return fail(502, "upstream", "Transcription failed unexpectedly", true);
  }
  if (err.message.includes("timed out")) return fail(504, "timeout", "Transcription timed out; try a shorter chunk", true);
  if (err.status === 429) return fail(503, "upstream_busy", "Transcription service is busy; retry shortly", true, 10);
  if (err.status && err.status >= 500) return fail(502, "upstream", "Transcription service error; retry shortly", true);
  if (err.status === 400) return fail(422, "upstream", `Transcription rejected the audio: ${err.message}`);
  return fail(502, "upstream", err.message, err.retryable);
}

async function readLimited(request: Request, limit: number): Promise<Uint8Array | "too_large"> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function tooLarge(config: ServerConfig) {
  return fail(413, "too_large", `Upload exceeds ${(config.maxUploadBytes / 1e6).toFixed(1)} MB`);
}

function fail(status: number, code: ApiErrorCode, error: string, retryable = false, retryAfterSec?: number) {
  const body: ApiError = { error, code, retryable, ...(retryAfterSec ? { retryAfterSec } : {}) };
  return Response.json(body, {
    status,
    headers: retryAfterSec ? { "retry-after": String(retryAfterSec) } : undefined,
  });
}

function log(fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event: "transcribe", ...fields }));
}
