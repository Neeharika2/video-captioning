/**
 * Browser client for POST /api/transcribe with upload progress, timeout and
 * retries. Uses XMLHttpRequest because fetch can't report upload progress.
 */
import {
  API_KEY_HEADER,
  TRANSCRIBE_PATH,
  type ApiError,
  type TranscribeResponse,
} from "../api-types";
import type { Word } from "../types";

export class TranscribeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiError["code"] | "network" | "aborted",
    readonly retryable: boolean,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "TranscribeError";
  }
}

export type TranscribeClientOptions = {
  /** The visitor's own Gemini key; forwarded to Google by our API and never stored. */
  apiKey: string;
  languages?: string[];
  signal?: AbortSignal;
  /** 0..1 upload progress; after 1 the server is transcribing. */
  onUploadProgress?: (fraction: number) => void;
  onRetry?: (attempt: number, err: TranscribeError) => void;
  /** Default 2 (one retry). */
  maxAttempts?: number;
  /** Per attempt. Default 295 s (route limit is 300 s). */
  timeoutMs?: number;
};

export async function transcribeChunk(audio: Blob, opts: TranscribeClientOptions): Promise<TranscribeResponse> {
  if (!opts.apiKey) {
    throw new TranscribeError("Add your Gemini API key in Settings", 401, "needs_api_key", false);
  }
  const maxAttempts = opts.maxAttempts ?? 2;
  for (let attempt = 1; ; attempt++) {
    try {
      return await send(audio, opts);
    } catch (err) {
      const e = err as TranscribeError;
      if (!(e instanceof TranscribeError) || !e.retryable || attempt >= maxAttempts || opts.signal?.aborted) throw e;
      opts.onRetry?.(attempt, e);
      const waitMs = (e.retryAfterSec ?? 2 ** attempt) * 1000;
      if (waitMs > 30_000) throw e; // e.g. quota reset at midnight: don't wait
      await sleep(waitMs, opts.signal);
    }
  }
}

function send(audio: Blob, opts: TranscribeClientOptions): Promise<TranscribeResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const qs = opts.languages?.length ? `?languages=${encodeURIComponent(opts.languages.join(","))}` : "";
    xhr.open("POST", `${TRANSCRIBE_PATH}${qs}`);
    xhr.setRequestHeader("content-type", "audio/ogg");
    xhr.setRequestHeader(API_KEY_HEADER, opts.apiKey);
    xhr.responseType = "json";
    xhr.timeout = opts.timeoutMs ?? 295_000;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onUploadProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
        resolve(xhr.response as TranscribeResponse);
        return;
      }
      const body = xhr.response as Partial<ApiError> | null;
      reject(
        new TranscribeError(
          body?.error ?? `Request failed (${xhr.status})`,
          xhr.status,
          body?.code ?? "upstream",
          // Gateways (e.g. Vercel 504) may return non-JSON; treat 5xx as retryable.
          body?.retryable ?? xhr.status >= 500,
          body?.retryAfterSec,
        ),
      );
    };
    xhr.onerror = () => reject(new TranscribeError("Network error", 0, "network", true));
    xhr.ontimeout = () => reject(new TranscribeError("Request timed out", 0, "timeout", true));
    xhr.onabort = () => reject(new TranscribeError("Cancelled", 0, "aborted", false));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(audio);
  });
}

/** Shift chunk-local word times onto the video timeline. */
export function offsetWords(words: Word[], offsetSec: number): Word[] {
  if (!offsetSec) return words;
  return words.map((w) => ({ ...w, start: w.start + offsetSec, end: w.end + offsetSec }));
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new TranscribeError("Cancelled", 0, "aborted", false));
      },
      { once: true },
    );
  });
}
