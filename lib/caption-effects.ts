/**
 * Caption effects as pure functions of time. The browser preview and the
 * burned-in export both draw through `drawCaption`, which reads its motion from
 * here, so a frame looks the same in both places. Nothing here touches the DOM.
 *
 * Distances are in em (multiples of the font size), so an effect looks the same
 * at any caption size or video resolution. Rotation is in radians.
 */
import type { AnimateBy, CaptionAnimation, CaptionLoop, WordMotion } from "./caption-style";
import type { Caption } from "./types";

/** How one unit (the caption, a word or a letter) is displaced from its resting place. */
export type Pose = {
  opacity: number;
  scale: number;
  dx: number;
  dy: number;
  rotate: number;
  /** Blur radius in em. */
  blur: number;
};

export const REST: Readonly<Pose> = Object.freeze({ opacity: 1, scale: 1, dx: 0, dy: 0, rotate: 0, blur: 0 });

/** How long one entrance runs, by what is animating. Shorter units move quicker. */
export const ENTER_SECONDS: Record<AnimateBy, number> = { caption: 0.32, word: 0.24, letter: 0.2 };

export const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
export const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
/** Overshoots just past 1, then settles. */
export const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

/**
 * Entrance pose at `progress` (0 = just appeared, 1 = settled). Anything at or
 * past 1, or not a number (a still frame passes `Infinity`), is the resting pose.
 */
export function enterPose(animation: CaptionAnimation, progress: number): Pose {
  if (animation === "none" || !(progress < 1)) return REST;
  const p = clamp01(progress);
  const e = easeOutCubic(p);
  switch (animation) {
    case "fade":
      return { ...REST, opacity: e };
    case "pop":
      return { ...REST, opacity: Math.min(1, e * 1.8), scale: 0.6 + 0.4 * easeOutBack(p) };
    case "rise":
      return { ...REST, opacity: e, dy: 0.5 * (1 - e) };
    case "drop":
      return { ...REST, opacity: Math.min(1, e * 1.5), dy: -0.6 * (1 - easeOutBack(p)) };
    case "slide":
      return { ...REST, opacity: e, dx: -0.6 * (1 - e) };
    case "zoom":
      return { ...REST, opacity: e, scale: 1 + 0.7 * (1 - e) };
    case "blur":
      return { ...REST, opacity: e, scale: 1 + 0.06 * (1 - e), blur: 0.3 * (1 - e) };
    case "bounce":
      // Springs in from nothing, wobbling past full size twice before it lands.
      return {
        ...REST,
        opacity: Math.min(1, p * 4),
        scale: Math.max(0.001, 1 - Math.cos(3 * Math.PI * p) * Math.exp(-4 * p) * (1 - p)),
      };
  }
  return REST;
}

/** Seconds a spoken-word motion takes to come on and to let go. */
const MOTION_ATTACK = 0.14;
const MOTION_RELEASE = 0.16;

/**
 * Motion of the word being spoken. `since` is seconds since the word started;
 * `after` is seconds since it stopped being the spoken word (`null` while it
 * still is), so held motions ease back instead of snapping.
 */
export function motionPose(motion: WordMotion, since: number, after: number | null = null): Pose {
  if (motion === "none" || since < 0) return REST;
  // A still frame passes Infinity: settle into the held pose, never NaN.
  const s = Number.isFinite(since) ? since : 10;
  const attack = clamp01(s / MOTION_ATTACK);
  const release = after === null ? 1 : 1 - easeOutCubic(clamp01(after / MOTION_RELEASE));
  switch (motion) {
    case "grow":
      return release > 0 ? { ...REST, scale: 1 + 0.16 * easeOutBack(attack) * release } : REST;
    case "lift":
      return release > 0 ? { ...REST, dy: -0.16 * easeOutCubic(attack) * release } : REST;
    case "pulse": {
      if (release <= 0) return REST;
      const beat = 0.07 + 0.05 * Math.sin(2 * Math.PI * 3 * s);
      return { ...REST, scale: 1 + beat * easeOutCubic(attack) * release };
    }
    case "hop": {
      const p = s / 0.3;
      return p >= 1 ? REST : { ...REST, dy: -0.25 * Math.sin(Math.PI * p) };
    }
    case "shake": {
      if (s > 0.45) return REST;
      const decay = Math.exp(-8 * s);
      return {
        ...REST,
        rotate: 0.09 * Math.sin(2 * Math.PI * 11 * s) * decay,
        dx: 0.04 * Math.sin(2 * Math.PI * 13 * s + 1) * decay,
      };
    }
  }
  return REST;
}

/** Deterministic 0–1 noise, so the preview and the export glitch on the same frames. */
export function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Whole-caption idle motion while it is on screen (float bobs, glitch jitters). */
export function loopBlockPose(loop: CaptionLoop, age: number): Pose {
  if (!Number.isFinite(age) || age < 0) return REST;
  if (loop === "float") {
    return {
      ...REST,
      dy: 0.05 * Math.sin(2 * Math.PI * 0.5 * age),
      rotate: 0.008 * Math.sin(2 * Math.PI * 0.25 * age + 0.6),
    };
  }
  if (loop === "glitch") {
    const g = glitchAmount(age);
    return g === 0 ? REST : { ...REST, dx: g };
  }
  return REST;
}

/** Vertical wave offset (em) of the `index`-th letter in the caption. */
export function waveOffset(age: number, index: number): number {
  if (!Number.isFinite(age)) return 0;
  return 0.12 * Math.sin(2 * Math.PI * 1.2 * age - index * 0.6);
}

/**
 * Horizontal glitch jitter in em, 0 when calm. Always glitches as the caption
 * lands, then in short random bursts (about one slot in eight).
 */
export function glitchAmount(age: number): number {
  if (!Number.isFinite(age) || age < 0) return 0;
  const slot = Math.floor(age * 14);
  if (age >= 0.18 && hash01(slot) >= 0.12) return 0;
  const g = (hash01(slot * 1.7 + 3.1) - 0.5) * 0.16;
  return g === 0 ? 0.02 : g;
}

/** Where the shine band is across the caption (0 → 1), or null between sweeps. */
export function shinePosition(age: number): number | null {
  if (!Number.isFinite(age) || age < 0) return null;
  const PERIOD = 2.6;
  const SWEEP = 0.9;
  const phase = age % PERIOD;
  return phase < SWEEP ? phase / SWEEP : null;
}

export type TokenTiming = { start: number; end: number };

/**
 * When each on-screen word is spoken. Uses the transcript's word times when the
 * caption text still lines up with them one-to-one; after an edit that breaks
 * the match, spreads the caption's time over the words by length instead, so
 * word effects keep working on edited captions.
 */
export function tokenTimings(caption: Caption, tokens: string[]): TokenTiming[] {
  const { start, end } = caption;
  const span = Math.max(0, end - start);
  if (tokens.length > 0 && tokens.length === caption.words.length) {
    let prev = start;
    return caption.words.map((w) => {
      const s = Math.min(end, Math.max(prev, w.start));
      prev = s;
      return { start: s, end: Math.min(end, Math.max(s, w.end)) };
    });
  }
  const weights = tokens.map((t) => Math.max(1, Array.from(t).length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = start;
  return weights.map((w) => {
    const s = at;
    at += (span * w) / total;
    return { start: s, end: at };
  });
}

/** Index of the word being spoken at `t` (the last one started), or -1 before the first. */
export function activeToken(timings: TokenTiming[], t: number): number {
  let found = -1;
  for (let i = 0; i < timings.length && timings[i].start <= t; i++) found = i;
  return found;
}

/** Gap between letters landing in letter-by-letter mode, fitted to the word's length. */
export function letterStagger(wordSeconds: number, letters: number): number {
  if (letters <= 1) return 0;
  const budget = Math.min(Math.max(0, wordSeconds), 0.4);
  return Math.min(0.06, Math.max(0.015, budget / letters));
}

/**
 * Scripts whose letters can be drawn one by one without breaking the word.
 * Indic scripts reorder and stack glyphs and Arabic joins letters, so those
 * words always move as a whole word instead of falling apart.
 */
export function canSplitLetters(word: string): boolean {
  return /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}\p{P}\p{S}]+$/u.test(word);
}

let segmenter: Intl.Segmenter | null | undefined;

/** User-perceived characters (keeps accents and emoji with their base). */
export function splitGraphemes(word: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  }
  return segmenter ? Array.from(segmenter.segment(word), (s) => s.segment) : Array.from(word);
}

/** True when the text is written right-to-left (Hebrew, Arabic and friends). */
export function isRtl(text: string): boolean {
  return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(text);
}

/** Black or white, whichever reads better on `hex` (used for text on a highlight box or marker). */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = Number.parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Pick the side with the higher WCAG contrast ratio.
  return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? "#111111" : "#ffffff";
}

/** Common English words that never make a good keyword. */
const STOPWORDS = new Set(
  (
    "a an the and or but if so to of in on at by for with from as is are was were be been being am do does did " +
    "have has had i you he she it we they me him her us them my your his its our their this that these those " +
    "there here what which who whom how when where why not no yes just very really can could will would should " +
    "shall may might must about into over than then too also up down out off again get got gonna wanna like " +
    "um uh hmm okay ok yeah im youre its dont cant thats lets one all some any more most such only own same"
  ).split(" "),
);

/**
 * Key words of a caption, as token indices: numbers and amounts first, then
 * the longest content words (English stop words and fillers never count).
 * Short captions get one keyword, longer ones two. Works on any script: for
 * non-Latin words length alone decides. Pure and local, so it also works on
 * edited captions without another API call.
 */
export function pickKeywords(tokens: string[]): Set<number> {
  const scored = tokens.map((token, index) => {
    const bare = token.toLowerCase().replace(/[\p{P}\p{S}]/gu, "");
    if (!bare) return { index, score: -1 };
    if (/\p{N}/u.test(bare)) return { index, score: 100 };
    if (STOPWORDS.has(bare)) return { index, score: -1 };
    let score = splitGraphemes(bare).length;
    if (/!$/.test(token)) score += 3;
    return { index, score };
  });
  const limit = tokens.length >= 6 ? 2 : 1;
  const picked = scored
    .filter((s) => s.score >= 4)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit);
  return new Set(picked.map((s) => s.index));
}

/** Keywords are set this much bigger than the rest of the caption. */
export const KEYWORD_SCALE = 1.22;

/**
 * Punchline word indices for a caption: the stored ones from the punchline pass
 * when they still line up with the words on screen, otherwise a local pick
 * (numbers first, then the longest content words). A lockup breaks on the
 * punchline, so when nothing scores we fall back to the last word to keep the
 * two-line shape.
 */
export function punchlineIndices(tokens: string[], stored?: number[], locked = false): Set<number> {
  const valid = stored?.filter((i) => Number.isInteger(i) && i >= 0 && i < tokens.length);
  if (valid && valid.length) return new Set(valid);
  const picked = pickKeywords(tokens);
  if (picked.size || !locked || !tokens.length) return picked;
  return new Set([tokens.length - 1]);
}

/**
 * Speaker index (0, 1, …) of each on-screen word. Speakers are numbered by
 * first appearance before captions are built (see `numberSpeakers`); after an
 * edit breaks the word match, the whole caption takes its first word's speaker.
 */
export function tokenSpeakers(caption: Caption, count: number): number[] {
  const index = (speaker?: string) => {
    const n = Number.parseInt(speaker ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  if (count === caption.words.length) return caption.words.map((w) => index(w.speaker));
  return Array.from({ length: count }, () => index(caption.words[0]?.speaker));
}

/**
 * Relabel speakers "0", "1", … in order of first appearance, whatever names the
 * transcription used, so speaker colours stay stable across the video.
 */
export function numberSpeakers<W extends { speaker?: string }>(words: W[]): W[] {
  const seen = new Map<string, string>();
  return words.map((w) => {
    if (!w.speaker) return w;
    let label = seen.get(w.speaker);
    if (label === undefined) {
      label = String(seen.size);
      seen.set(w.speaker, label);
    }
    return label === w.speaker ? w : { ...w, speaker: label };
  });
}
