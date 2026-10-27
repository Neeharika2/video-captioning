/**
 * Browser side of the punchline pass: splits the caption list into batches,
 * sends them to /api/punchlines (a couple at a time), and reports the picked
 * indices batch by batch. A batch that fails keeps the local pick; nothing here
 * throws unless the user cancels.
 */
import type { ApiError } from "../api-types";
import { apiKeyHeaders } from "./api-key";
import {
  MAX_PUNCHLINE_CAPTIONS,
  PUNCHLINE_CONTEXT_CAPTIONS,
  PUNCHLINE_PATH,
  type PunchlineRequest,
  type PunchlineResponse,
} from "../punchlines";

const BATCH_CAPTIONS = 40;
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 30_000;

export type PunchlineOptions = {
  /** The visitor's own Gemini key; forwarded to Google by our API and never stored. */
  apiKey: string;
  signal?: AbortSignal;
  /** Called as each batch finishes, with its results placed at `start`. */
  onBatch?: (start: number, results: (number[] | null)[]) => void;
};

export type PunchlineSummary = {
  /** Captions the model picked a punchline for and that passed the checks. */
  accepted: number;
  /** Captions whose answer failed a check (local pick kept). */
  rejected: number;
  /** Captions in batches that failed outright (local pick kept). */
  failed: number;
  batches: number;
  model?: string;
  lastError?: string;
};

/** Split into batches of ≤ `size` captions. */
export function planCaptionBatches(captions: string[][], size = BATCH_CAPTIONS): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < captions.length; start += size) {
    out.push({ start, end: Math.min(captions.length, start + size) });
  }
  return out;
}

export async function pickPunchlines(captions: string[][], opts: PunchlineOptions): Promise<PunchlineSummary> {
  const summary: PunchlineSummary = { accepted: 0, rejected: 0, failed: 0, batches: 0 };
  if (!opts.apiKey) throw new Error("Add your Gemini API key in Settings");
  const batches = planCaptionBatches(captions);
  summary.batches = batches.length;
  if (!batches.length) return summary;

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const { start, end } = batches[next++];
      const request: PunchlineRequest = {
        captions: captions.slice(start, end),
        before: captions.slice(Math.max(0, start - PUNCHLINE_CONTEXT_CAPTIONS), start),
        after: captions.slice(end, end + PUNCHLINE_CONTEXT_CAPTIONS),
      };
      try {
        const res = await postBatch(request, opts.apiKey, opts.signal);
        summary.model = res.model;
        summary.rejected += res.rejected;
        summary.accepted += res.punchlines.filter((p) => Array.isArray(p) && p.length).length;
        opts.onBatch?.(start, res.punchlines);
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        summary.failed += end - start;
        summary.lastError = (err as Error).message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return summary;
}

async function postBatch(body: PunchlineRequest, apiKey: string, signal?: AbortSignal): Promise<PunchlineResponse> {
  if (body.captions.length > MAX_PUNCHLINE_CAPTIONS) throw new Error("Batch too large");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(PUNCHLINE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...apiKeyHeaders(apiKey) },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) {
      const json = (await res.json()) as PunchlineResponse;
      if (!Array.isArray(json.punchlines) || json.punchlines.length !== body.captions.length) {
        throw new Error("Punchline response doesn't match the request");
      }
      return json;
    }
    const err = (await res.json().catch(() => undefined)) as ApiError | undefined;
    if (!err?.retryable || attempt >= MAX_ATTEMPTS) throw new Error(err?.error ?? `HTTP ${res.status}`);
    const waitMs = Math.min(MAX_WAIT_MS, (err.retryAfterSec ?? 2 ** attempt) * 1000);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, waitMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}
