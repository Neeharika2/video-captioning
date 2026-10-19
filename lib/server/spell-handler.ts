import "server-only";
import type { ApiError, ApiErrorCode } from "../api-types";
import { GeminiError } from "../gemini";
import { generateJson } from "../gemini-text";
import {
  buildSpellPrompt,
  reconcileSpelling,
  SPELL_RESPONSE_JSON_SCHEMA,
  SPELL_SYSTEM_PROMPT,
  SpellRequestSchema,
  type SpellResponse,
} from "../spelling";
import { getConfig, type ServerConfig } from "./config";
import { missingKeyMessage, readApiKey } from "./api-key";
import { getRateLimiter, type RateLimiter } from "./limits";

export type SpellDeps = {
  config?: ServerConfig;
  limiter?: RateLimiter;
  generate?: typeof generateJson;
};

const MAX_BODY_BYTES = 64_000;

/**
 * POST /api/spell
 *
 * Body (JSON): { words: string[], before?, after?, glossary? }
 * Header: `x-gemini-api-key` — the visitor's own key, forwarded to Google and
 * never stored. Returns one spelling per word, or null where the model's answer
 * failed the checks in lib/spelling.ts (the client keeps its rule-based
 * spelling there). Never logs transcript text or the key.
 */
export async function handleSpell(request: Request, deps: SpellDeps = {}): Promise<Response> {
  const config = deps.config ?? getConfig();
  const started = Date.now();

  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return fail(415, "unsupported_media", "Send JSON with Content-Type: application/json");
  }

  const apiKey = readApiKey(request);
  if (!apiKey.ok) return fail(401, "needs_api_key", missingKeyMessage(apiKey.reason));

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "too_large", "Too much text in one request");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", "Body is not valid JSON");
  }
  const parsed = SpellRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad_request", `Invalid request: ${parsed.error.issues[0]?.message ?? "bad shape"}`);
  const req = parsed.data;

  const limiter = deps.limiter ?? getRateLimiter(config);
  const decision = await limiter.limit(`spell:${apiKey.id}`);
  if (!decision.ok) {
    log({ status: 429, keyId: apiKey.id, words: req.words.length, error: "rate_limited", retryAfterSec: decision.retryAfterSec });
    return fail(429, "rate_limited", "Too many requests; slow down", true, decision.retryAfterSec);
  }

  try {
    const result = await (deps.generate ?? generateJson)({
      apiKey: apiKey.key,
      model: config.spellModel,
      system: SPELL_SYSTEM_PROMPT,
      prompt: buildSpellPrompt(req),
      schema: SPELL_RESPONSE_JSON_SCHEMA,
      signal: request.signal,
      timeoutMs: 50_000,
      maxAttempts: 2,
    });
    const { words, rejections } = reconcileSpelling(req.words, result.json, req.glossary);
    log({
      status: 200,
      keyId: apiKey.id,
      words: req.words.length,
      rejected: rejections.length,
      reasons: countBy(rejections.map((r) => r.reason)),
      ms: Date.now() - started,
      attempts: result.attempts,
    });
    const response: SpellResponse = { words, rejected: rejections.length, model: config.spellModel };
    return Response.json(response);
  } catch (err) {
    const res = mapUpstreamError(err);
    log({ status: res.status, keyId: apiKey.id, words: req.words.length, ms: Date.now() - started, error: (err as Error).message });
    return res;
  }
}

function mapUpstreamError(err: unknown): Response {
  if (!(err instanceof GeminiError)) {
    if ((err as Error)?.name === "AbortError") return fail(499, "timeout", "Request aborted by client", true);
    return fail(502, "upstream", "Spelling check failed unexpectedly", true);
  }
  if (err.message.includes("timed out")) return fail(504, "timeout", "Spelling check timed out", true);
  if (err.status === 429) return fail(503, "upstream_busy", "Spelling service is busy; retry shortly", true, 20);
  if (err.status && err.status >= 500) return fail(502, "upstream", "Spelling service error; retry shortly", true);
  return fail(502, "upstream", err.message, err.retryable);
}

function countBy(items: string[]) {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}

function fail(status: number, code: ApiErrorCode, error: string, retryable = false, retryAfterSec?: number) {
  const body: ApiError = { error, code, retryable, ...(retryAfterSec ? { retryAfterSec } : {}) };
  return Response.json(body, {
    status,
    headers: retryAfterSec ? { "retry-after": String(retryAfterSec) } : undefined,
  });
}

function log(fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event: "spell", ...fields }));
}
