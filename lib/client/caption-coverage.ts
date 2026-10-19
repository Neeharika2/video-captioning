/**
 * Coverage maths for multi-request transcription.
 *
 * Gemini locks onto one spoken language per request and silently omits regions
 * in other languages (a Hindi→Telugu clip comes back Telugu-only; a five-language
 * montage can come back empty). We therefore transcribe the whole track once, then
 * find the parts no word covers and transcribe those separately, splitting until
 * each request lands on a single language.
 *
 * These helpers are pure so the splitting/merging rules are unit-tested.
 */
import type { Word } from "../types";

export type TimeRange = { start: number; end: number };

/** Text with punctuation and case removed, to spot the same word across a seam. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[\p{P}\p{S}]/gu, "").trim();
}

/** The parts of [start, end] that words cover, as disjoint intervals. */
export function coveredRanges(words: Word[], start: number, end: number): TimeRange[] {
  const spans = words
    .map((w) => ({ start: Math.max(start, w.start), end: Math.min(end, w.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TimeRange[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + 1e-3) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** The parts of [start, end] no word covers, ignoring blips shorter than minGapSec. */
export function findCoverageGaps(words: Word[], start: number, end: number, minGapSec = 2.5): TimeRange[] {
  if (end <= start) return [];
  const gaps: TimeRange[] = [];
  let cursor = start;
  for (const span of coveredRanges(words, start, end)) {
    if (span.start - cursor >= minGapSec) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (end - cursor >= minGapSec) gaps.push({ start: cursor, end });
  return gaps;
}

/** Share of [start, end] that words cover, 0..1. */
export function coverageRatio(words: Word[], start: number, end: number): number {
  if (end <= start) return 1;
  const covered = coveredRanges(words, start, end).reduce((sum, s) => sum + (s.end - s.start), 0);
  return Math.min(1, covered / (end - start));
}

/** Cut a range in half; callers recurse until each piece is single-language. */
export function splitRange(range: TimeRange): [TimeRange, TimeRange] {
  const mid = (range.start + range.end) / 2;
  return [
    { start: range.start, end: mid },
    { start: mid, end: range.end },
  ];
}

/** Split a range into the fewest equal windows no longer than maxLen. */
export function planWindows(range: TimeRange, maxLen: number): TimeRange[] {
  const length = range.end - range.start;
  if (length <= maxLen || maxLen <= 0) return [range];
  const count = Math.ceil(length / maxLen - 1e-6);
  const step = length / count;
  return Array.from({ length: count }, (_, i) => ({
    start: range.start + i * step,
    end: i === count - 1 ? range.end : range.start + (i + 1) * step,
  }));
}

/**
 * Combine words collected from several requests into one sorted timeline,
 * dropping the duplicate a word gets when two chunks both hear it at a seam.
 */
export function mergeWords(chunks: Word[][]): Word[] {
  const all = chunks
    .flat()
    .filter((w) => w.text.trim() && w.end > w.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Word[] = [];
  for (const w of all) {
    const prev = out[out.length - 1];
    const seamDuplicate =
      prev !== undefined && w.start < prev.end - 0.05 && normalise(prev.text) === normalise(w.text);
    if (seamDuplicate) {
      // Keep the longer timing of the two.
      if (w.end - w.start > prev.end - prev.start) out[out.length - 1] = w;
      continue;
    }
    out.push(w);
  }
  return out;
}
