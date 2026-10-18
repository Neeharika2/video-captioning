/**
 * Browser side of smart spelling: splits the transcript into batches, sends
 * them to /api/spell (a few at a time), and reports results batch by batch.
 * A batch that fails keeps the rule-based spelling; nothing here throws
 * unless the user cancels.
 */
import type { ApiError } from "../api-types";
import { hasNonLatinLetters } from "../romanize";
import {
  MAX_SPELL_WORDS,
  SPELL_CONTEXT_WORDS,
  SPELL_PATH,
  type SpelledWord,
  type SpellRequest,
  type SpellResponse,
} from "../spelling";

const BATCH_WORDS = 250;
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 30_000;

export type SpellOptions = {
  glossary?: string[];
  languages?: string[];
  signal?: AbortSignal;
  /** Called as each batch finishes, with its results placed at `start`. */
  onBatch?: (start: number, results: (SpelledWord | null)[]) => void;
};

export type SpellSummary = {
  /** Words the model respelled and that passed the checks. */
  accepted: number;
  /** Words whose answer failed a check (rule-based spelling kept). */
  rejected: number;
  /** Words in batches that failed outright (rule-based spelling kept). */
  failed: number;
  batches: number;
  model?: string;
  lastError?: string;
};

/** Split into batches of ≤ BATCH_WORDS, preferring to end on a sentence. */
export function planBatches(words: string[], size = BATCH_WORDS): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(words.length, start + size);
    if (end < words.length) {
      for (let k = end; k > start + size * 0.6; k--) {
        if (/[.!?。！？؟।]["'”’)\]]*$/u.test(words[k - 1])) {
          end = k;
          break;
        }
      }
    }
    out.push({ start, end });
    start = end;
  }
  return out;
}

export async function spellWords(words: string[], opts: SpellOptions = {}): Promise<SpellSummary> {
  const summary: SpellSummary = { accepted: 0, rejected: 0, failed: 0, batches: 0 };
  // Only batches with non-Latin text need the model.
  const batches = planBatches(words).filter((b) => words.slice(b.start, b.end).some(hasNonLatinLetters));
  summary.batches = batches.length;

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const { start, end } = batches[next++];
      const request: SpellRequest = {
        words: words.slice(start, end),
        before: words.slice(Math.max(0, start - SPELL_CONTEXT_WORDS), start),
        after: words.slice(end, end + SPELL_CONTEXT_WORDS),
        ...(opts.glossary?.length ? { glossary: opts.glossary } : {}),
        ...(opts.languages?.length ? { languages: opts.languages } : {}),
      };
      try {
        const res = await postBatch(request, opts.signal);
        summary.model = res.model;
        summary.rejected += res.rejected;
        summary.accepted += res.words.filter(Boolean).length;
        opts.onBatch?.(start, res.words);
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

async function postBatch(body: SpellRequest, signal?: AbortSignal): Promise<SpellResponse> {
  if (body.words.length > MAX_SPELL_WORDS) throw new Error("Batch too large");
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(SPELL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) {
      const json = (await res.json()) as SpellResponse;
      if (!Array.isArray(json.words) || json.words.length !== body.words.length) {
        throw new Error("Spelling response doesn't match the request");
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
