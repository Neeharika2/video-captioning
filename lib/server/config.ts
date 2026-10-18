import "server-only";
import { DEFAULT_MODEL } from "../gemini";
import { DEFAULT_TEXT_MODEL } from "../gemini-text";

/** Server configuration from env. Read lazily so tests can set env per case. */
export function getConfig() {
  const env = process.env;
  return {
    geminiModel: env.GEMINI_MODEL || DEFAULT_MODEL,
    /** Text model for the smart-spelling pass. */
    spellModel: env.GEMINI_SPELL_MODEL || DEFAULT_TEXT_MODEL,
    /** Max requests per minute, per visitor key and endpoint. */
    requestsPerMinute: positive(env.RATE_LIMIT_PER_MINUTE, 20),
    /** Longest chunk accepted, in seconds (PLAN.md: ≤10 min chunks). */
    maxChunkSeconds: positive(env.MAX_CHUNK_SECONDS, 600),
    /** Max upload size; Vercel rejects bodies above 4.5 MB anyway. */
    maxUploadBytes: positive(env.MAX_UPLOAD_BYTES, 4_400_000),
    upstashUrl: env.UPSTASH_REDIS_REST_URL ?? "",
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN ?? "",
    isProduction: env.NODE_ENV === "production",
  };
}

export type ServerConfig = ReturnType<typeof getConfig>;

function positive(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
