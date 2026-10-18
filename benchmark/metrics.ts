import { alignSequences, countEdits } from "../lib/align";
import type { Word } from "../lib/types";

/**
 * Normalize text for scoring: NFC, lowercase, drop apostrophes, turn other
 * punctuation/symbols into spaces. Combining marks (Telugu vowel signs) are kept.
 */
export function normalizeTokens(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function toGraphemes(tokens: string[]): string[] {
  return Array.from(graphemes.segment(tokens.join("")), (s) => s.segment);
}

export type ErrorRate = { rate: number; edits: number; refLength: number; sub: number; del: number; ins: number };

function errorRate(ref: string[], hyp: string[]): ErrorRate {
  const c = countEdits(alignSequences(ref, hyp, (a, b) => a === b));
  return {
    rate: ref.length ? c.edits / ref.length : hyp.length ? 1 : 0,
    edits: c.edits,
    refLength: ref.length,
    sub: c.sub,
    del: c.del,
    ins: c.ins,
  };
}

export function wordErrorRate(reference: string, hypothesis: string): ErrorRate {
  return errorRate(normalizeTokens(reference), normalizeTokens(hypothesis));
}

/** CER over grapheme clusters, spaces removed (works for Telugu and Latin). */
export function charErrorRate(reference: string, hypothesis: string): ErrorRate {
  return errorRate(toGraphemes(normalizeTokens(reference)), toGraphemes(normalizeTokens(hypothesis)));
}

export type Script = "telugu" | "latin" | "other";
export function scriptOf(token: string): Script {
  if (/\p{Script=Telugu}/u.test(token)) return "telugu";
  if (/\p{Script=Latin}/u.test(token)) return "latin";
  return "other";
}

/** Per-script word accuracy: share of reference words in each script that the hypothesis got exactly right. */
export function scriptAccuracy(reference: string, hypothesis: string) {
  const ref = normalizeTokens(reference);
  const ops = alignSequences(ref, normalizeTokens(hypothesis), (a, b) => a === b);
  const totals: Record<Script, { correct: number; total: number }> = {
    telugu: { correct: 0, total: 0 },
    latin: { correct: 0, total: 0 },
    other: { correct: 0, total: 0 },
  };
  for (const o of ops) {
    if (o.op === "ins") continue;
    const t = totals[scriptOf(o.a)];
    t.total++;
    if (o.op === "match") t.correct++;
  }
  const acc = (s: Script) => (totals[s].total ? totals[s].correct / totals[s].total : undefined);
  return { telugu: acc("telugu"), latin: acc("latin"), counts: totals };
}

export type TimingResult = {
  /** Ground-truth words that had a same-text hypothesis word within the search window. */
  matched: number;
  total: number;
  meanStartError?: number;
  meanEndError?: number;
  medianStartError?: number;
  /** Share of matched words with both start and end within ±0.15 s. */
  within150ms?: number;
};

/**
 * Timing error over a (possibly sampled) set of ground-truth words. Each truth
 * word is paired with the nearest hypothesis word of the same normalized text
 * whose start is within `windowSec`.
 */
export function timingError(truth: Word[], hypothesis: Word[], windowSec = 2): TimingResult {
  const hyp = hypothesis.map((w) => ({ ...w, norm: normalizeTokens(w.text).join("") }));
  const startErrs: number[] = [];
  const endErrs: number[] = [];
  let within = 0;
  for (const t of truth) {
    const norm = normalizeTokens(t.text).join("");
    let best: (typeof hyp)[number] | undefined;
    for (const h of hyp) {
      if (h.norm !== norm || Math.abs(h.start - t.start) > windowSec) continue;
      if (!best || Math.abs(h.start - t.start) < Math.abs(best.start - t.start)) best = h;
    }
    if (!best) continue;
    const se = Math.abs(best.start - t.start);
    const ee = Math.abs(best.end - t.end);
    startErrs.push(se);
    endErrs.push(ee);
    if (se <= 0.15 && ee <= 0.15) within++;
  }
  const n = startErrs.length;
  if (!n) return { matched: 0, total: truth.length };
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const sorted = [...startErrs].sort((a, b) => a - b);
  return {
    matched: n,
    total: truth.length,
    meanStartError: mean(startErrs),
    meanEndError: mean(endErrs),
    medianStartError: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    within150ms: within / n,
  };
}

/**
 * Glossary recall: for each glossary term, how many of its occurrences in the
 * reference also appear in the hypothesis (capped per term).
 */
export function glossaryRecall(reference: string, hypothesis: string, glossary: string[]) {
  const ref = ` ${normalizeTokens(reference).join(" ")} `;
  const hyp = ` ${normalizeTokens(hypothesis).join(" ")} `;
  let expected = 0;
  let found = 0;
  for (const term of glossary) {
    const t = normalizeTokens(term).join(" ");
    if (!t) continue;
    const inRef = countOccurrences(ref, ` ${t} `);
    if (!inRef) continue;
    expected += inRef;
    found += Math.min(inRef, countOccurrences(hyp, ` ${t} `));
  }
  return { recall: expected ? found / expected : undefined, found, expected };
}

function countOccurrences(haystack: string, needle: string) {
  let count = 0;
  // Step by needle length minus the trailing space so adjacent matches share it.
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length - 1)) count++;
  return count;
}
