/**
 * Turn word timings into caption cues (PLAN.md §7).
 *
 * Cue timing comes straight from the words: a cue starts when its first word
 * starts and ends when its last word ends, then is held a little longer if it
 * would flash by too fast to read (never overlapping the next cue).
 */
import type { Caption, Word } from "./types";

export type GroupOptions = {
  maxCharsPerLine: number;
  maxLines: number;
  /** Most words in one cue. Short-form captions read best at 3–4 words. */
  maxWords: number;
  /** Reading speed used to hold short cues on screen longer. */
  maxCharsPerSecond: number;
  /** Seconds. */
  maxDuration: number;
  /** Seconds. */
  minDuration: number;
  /** A pause longer than this (ms) starts a new cue. */
  gapMs: number;
  removeFillers: boolean;
};

export const DEFAULT_GROUP_OPTIONS: GroupOptions = {
  maxCharsPerLine: 42,
  maxLines: 2,
  maxWords: 4,
  maxCharsPerSecond: 20,
  maxDuration: 6,
  minDuration: 1,
  // PLAN.md proposed 300 ms; Gemini timings come in 0.1 s steps and natural
  // pauses often exceed 300 ms, which over-splits. Tune with Phase 0 clips.
  gapMs: 500,
  removeFillers: true,
};

/** Unambiguous fillers only; "like" / "you know" carry meaning too often. */
const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "hmm", "hm", "mm", "er", "erm", "ah"]);

const SENTENCE_END = /[.!?…।॥]["'”’)\]]*$/u;
const CLAUSE_END = /[,;:—–]["'”’)\]]*$/u;
/** Minimum gap kept between a held cue and the next one (seconds). */
const CUE_SPACING = 0.04;

function bare(text: string) {
  return text.toLowerCase().replace(/[\p{P}\p{S}]/gu, "");
}

export function isFiller(text: string) {
  return FILLERS.has(bare(text));
}

export function groupWords(input: Word[], options: Partial<GroupOptions> = {}): Caption[] {
  const opts = { ...DEFAULT_GROUP_OPTIONS, ...options };
  const maxChars = opts.maxCharsPerLine * opts.maxLines;
  const maxWords = Math.max(1, opts.maxWords);
  const gap = opts.gapMs / 1000;

  // Drop fillers, but keep the sentence break a filler like "um." carried.
  const words: (Word & { breakAfter?: boolean })[] = [];
  for (const w of input) {
    if (!w.text.trim()) continue;
    if (opts.removeFillers && isFiller(w.text)) {
      if (SENTENCE_END.test(w.text) && words.length) words[words.length - 1].breakAfter = true;
      continue;
    }
    words.push({ ...w });
  }

  const groups: Word[][] = [];
  let current: (Word & { breakAfter?: boolean })[] = [];
  let currentChars = 0;

  // Balance word counts inside a stretch of speech: `runEnd[i]` is the first
  // index after the run of words that has no sentence end, long pause or
  // speaker change in it.
  const runEnd = new Array<number>(words.length);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    const next = words[i + 1];
    const endsRun =
      w.breakAfter ||
      SENTENCE_END.test(w.text) ||
      !next ||
      next.start - w.end > gap ||
      (next.speaker !== undefined && w.speaker !== undefined && next.speaker !== w.speaker);
    runEnd[i] = endsRun ? i + 1 : runEnd[i + 1];
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (current.length) {
      const prev = current[current.length - 1];
      const nextChars = currentChars + 1 + w.text.length;
      // If capping at maxWords would leave only 1–2 words for the rest of the
      // run, break one word early so the cues stay 3–4 words where possible.
      const remaining = runEnd[i] - i;
      const tail = (current.length + remaining) % maxWords;
      const avoidShortTail = maxWords >= 3 && current.length === maxWords - 1 && (tail === 1 || tail === 2);
      const shouldBreak =
        current.length >= maxWords ||
        avoidShortTail ||
        prev.breakAfter ||
        SENTENCE_END.test(prev.text) ||
        w.start - prev.end > gap ||
        (w.speaker !== undefined && prev.speaker !== undefined && w.speaker !== prev.speaker) ||
        w.end - current[0].start > opts.maxDuration ||
        nextChars > maxChars ||
        (nextChars > opts.maxCharsPerLine && !fitsLines([...current, w], opts)) ||
        // Prefer breaking at a comma once the cue already fills a line.
        (CLAUSE_END.test(prev.text) && currentChars >= opts.maxCharsPerLine);
      if (shouldBreak) {
        groups.push(current);
        current = [];
        currentChars = 0;
      }
    }
    current.push(w);
    currentChars += (currentChars ? 1 : 0) + w.text.length;
  }
  if (current.length) groups.push(current);

  const captions: Caption[] = groups.map((ws, i) => {
    const text = ws.map((w) => w.text).join(" ");
    return {
      id: `cue-${i + 1}`,
      text,
      start: ws[0].start,
      end: Math.max(ws[ws.length - 1].end, ws[0].start + 0.1),
      words: ws.map(({ text, start, end, speaker, alt }) => ({
        text,
        start,
        end,
        ...(speaker ? { speaker } : {}),
        ...(alt ? { alt } : {}),
      })),
      lines: wrapLines(text, opts.maxCharsPerLine, opts.maxLines),
    };
  });

  // Hold short cues long enough to read, without running into the next cue.
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i];
    const wanted = c.start + Math.max(opts.minDuration, c.text.length / opts.maxCharsPerSecond);
    const limit = i + 1 < captions.length ? captions[i + 1].start - CUE_SPACING : Infinity;
    if (c.end < wanted) c.end = Math.max(c.end, Math.min(wanted, limit));
  }
  return captions;
}

function fitsLines(ws: Word[], opts: GroupOptions) {
  const lines = wrapLines(ws.map((w) => w.text).join(" "), opts.maxCharsPerLine, opts.maxLines);
  return lines.every((l) => l.length <= opts.maxCharsPerLine);
}

/**
 * Split text into at most `maxLines` lines of ≤ `maxCharsPerLine`, balancing
 * line lengths. Falls back to the most balanced split if nothing fits.
 */
export function wrapLines(text: string, maxCharsPerLine: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length <= maxCharsPerLine || words.length < 2 || maxLines < 2) return [words.join(" ")];

  let best: { lines: string[]; score: number } | undefined;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const over = Math.max(0, a.length - maxCharsPerLine) + Math.max(0, b.length - maxCharsPerLine);
    // Overflow dominates; then balance (slightly prefer a shorter top line).
    const score = over * 1000 + Math.abs(a.length - b.length) + (a.length > b.length ? 0.5 : 0);
    if (!best || score < best.score) best = { lines: [a, b], score };
  }
  return best!.lines;
}
