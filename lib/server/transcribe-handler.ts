import "server-only";
import { SPEAKERS_HEADER, type ApiError, type ApiErrorCode, type TranscribeResponse } from "../api-types";
import { GeminiError, formatWait, transcribe as geminiTranscribe } from "../gemini";
import { OggOpusError, oggOpusDuration } from "../ogg-duration";
import type { Word } from "../types";
import { missingKeyMessage, readApiKey } from "./api-key";
import { getConfig, type ServerConfig } from "./config";
import { getRateLimiter, type RateLimiter } from "./limits";

export type HandlerDeps = {
  config?: ServerConfig;
  limiter?: RateLimiter;
  transcribe?: typeof geminiTranscribe;
};

/**
 * POST /api/transcribe
 *
 * Body: one Ogg Opus chunk (Content-Type: audio/ogg), ≤ maxChunkSeconds.
 *
 * Bring your own key: the visitor's Gemini key arrives in the
 * `x-gemini-api-key` header, is forwarded to Google for this request and never
 * stored. Spend therefore belongs to the visitor, so requests are only
 * rate-limited (per key and endpoint), not capped by a shared daily budget.
 *
 * Language is always auto-detected: no hint is accepted, so a stray setting can
 * never force the wrong language (which is how one video leaked onto the next).
 *
 * Stateless: returns chunk-local word timings; the browser stitches chunks.
 * Never logs audio, transcript text or the key.
 */
export async function handleTranscribe(request: Request, deps: HandlerDeps = {}): Promise<Response> {
  const config = deps.config ?? getConfig();
  const started = Date.now();

  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "audio/ogg" && contentType !== "audio/opus") {
    return fail(415, "unsupported_media", "Send Ogg Opus audio with Content-Type: audio/ogg");
  }

  const apiKey = readApiKey(request);
  if (!apiKey.ok) return fail(401, "needs_api_key", missingKeyMessage(apiKey.reason));

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

  const limiter = deps.limiter ?? getRateLimiter(config);
  const decision = await limiter.limit(`transcribe:${apiKey.id}`);
  if (!decision.ok) {
    log({ durationSec, keyId: apiKey.id, status: 429, error: "rate_limited", retryAfterSec: decision.retryAfterSec });
    return fail(429, "rate_limited", "Too many requests; slow down", true, decision.retryAfterSec);
  }

  try {
    const result = await (deps.transcribe ?? geminiTranscribe)({
      apiKey: apiKey.key,
      model: config.geminiModel,
      audio,
      mimeType: "audio/ogg",
      timestamps: true,
      // Speaker labels only when asked: they're for per-speaker colours.
      diarization: request.headers.get(SPEAKERS_HEADER) === "1",
      signal: request.signal,
      // Leave headroom under the route's maxDuration for parsing + response.
      timeoutMs: 270_000,
      maxAttempts: 2,
    });
    const fallback = !result.words.length && result.text.trim() ? "even-timing" : undefined;
    const words = fallback ? spreadWords(result.text, durationSec) : result.words;
    log({
      durationSec,
      keyId: apiKey.id,
      status: 200,
      words: words.length,
      // Whether the model returned any transcript: 0 words + 0 text means the
      // clip had no transcribable speech, which the UI surfaces to the visitor.
      textLen: result.text.length,
      ...(fallback ? { fallback } : {}),
      ms: Date.now() - started,
      attempts: result.attempts,
    });
    const body: TranscribeResponse = {
      words,
      text: result.text,
      durationSec,
      model: config.geminiModel,
    };
    return Response.json(body);
  } catch (err) {
    const res = mapUpstreamError(err, config);
    log({
      durationSec,
      keyId: apiKey.id,
      status: res.status,
      ms: Date.now() - started,
      upstreamStatus: err instanceof GeminiError ? err.status : undefined,
      retryAfterSec: err instanceof GeminiError ? err.retryAfterSec : undefined,
      error: (err as Error).message,
    });
    return res;
  }
}

/**
 * Last resort for a transcript the model returned without word timings: cues
 * are built from word times, so a text-only response would otherwise land as an
 * empty editor. Spread the words evenly across the chunk instead — approximate,
 * but visible and editable, which beats showing nothing.
 */
function spreadWords(text: string, durationSec: number): Word[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length || !(durationSec > 0)) return [];
  const step = durationSec / parts.length;
  return parts.map((word, i) => ({ text: word, start: i * step, end: (i + 1) * step }));
}

function mapUpstreamError(err: unknown, config: ServerConfig): Response {
  if (!(err instanceof GeminiError)) {
    if ((err as Error)?.name === "AbortError") return fail(499, "timeout", "Request aborted by client", true);
    return fail(502, "upstream", "Transcription failed unexpectedly", true);
  }
  if (err.message.includes("timed out")) return fail(504, "timeout", "Transcription timed out; try a shorter chunk", true);
  if (err.status === 429) {
    // Daily limits ask us to wait hours (free tier: 25 requests/day). Retrying
    // is pointless, and waiting would keep the UI on "Transcribing…".
    const daily = (err.retryAfterSec ?? 0) > 60 || /per day|daily quota/i.test(err.message);
    if (daily) {
      const when = err.retryAfterSec ? ` Retry in ${formatWait(err.retryAfterSec)}.` : "";
      return fail(
        429,
        "quota_exceeded",
        `Gemini daily limit reached for ${config.geminiModel}.${when} ` +
          "This API key is on the free tier (25 transcription requests per day); enable billing or use a paid-tier key.",
        false,
        err.retryAfterSec,
      );
    }
    return fail(503, "upstream_busy", "Transcription service is busy; retry shortly", true, err.retryAfterSec ?? 10);
  }
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
