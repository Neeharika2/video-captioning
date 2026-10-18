import "server-only";
import { createHash } from "node:crypto";
import { API_KEY_HEADER } from "../api-types";

/**
 * The visitor's own Gemini API key, read from the request.
 *
 * Keys are never persisted server-side (no env, no store, no logs). Only the
 * opaque `id` travels further, for rate-limit buckets and observability.
 */
export type ApiKeyResult = { ok: true; key: string; id: string } | { ok: false; reason: "missing" | "invalid" };

/** Google keys are long; anything short or containing spaces is a paste mistake. */
const API_KEY_RE = /^[A-Za-z0-9._~-]{16,512}$/;

export function readApiKey(request: Request): ApiKeyResult {
  const raw = request.headers.get(API_KEY_HEADER);
  if (!raw) return { ok: false, reason: "missing" };
  const key = raw.trim();
  if (!API_KEY_RE.test(key)) return { ok: false, reason: "invalid" };
  return { ok: true, key, id: apiKeyId(key) };
}

/** Stable, non-reversible id for rate limits and logs — never the key itself. */
export function apiKeyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function missingKeyMessage(reason: "missing" | "invalid"): string {
  return reason === "invalid"
    ? "That Gemini API key doesn't look valid; check it in Settings"
    : "Add your Gemini API key in Settings to use captions";
}
