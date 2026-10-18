/** Request/response contract of POST /api/transcribe, shared by client and server. */
import type { Word } from "./types";

export const TRANSCRIBE_PATH = "/api/transcribe";

export type TranscribeResponse = {
  /** Chunk-local times in seconds. */
  words: Word[];
  text: string;
  /** Duration measured by the server from the Ogg stream. */
  durationSec: number;
  model: string;
  quota: { usedSeconds: number; limitSeconds: number };
};

export type ApiErrorCode =
  | "misconfigured"
  | "bad_request"
  | "unsupported_media"
  | "too_large"
  | "too_long"
  | "rate_limited"
  | "quota_exceeded"
  | "upstream_busy"
  | "upstream"
  | "timeout";

export type ApiError = {
  error: string;
  code: ApiErrorCode;
  /** Whether resending the same request may succeed. */
  retryable: boolean;
  retryAfterSec?: number;
};

/** Accepts e.g. "te-IN", "en", "zh-Hant-TW". */
export const LANGUAGE_CODE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
export const MAX_LANGUAGE_CODES = 5;
