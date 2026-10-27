import type { CaptionPlacement } from "./caption-style";

/** One spoken word with times in seconds. */
export type Word = {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  /** The same word in the other script (original ↔ English letters), for bilingual captions. */
  alt?: string;
};

export type Caption = {
  id: string;
  /** Editable independently of `words`. */
  text: string;
  start: number;
  end: number;
  /** Kept for word highlighting and cheap re-grouping. */
  words: Word[];
  lines?: string[];
  /**
   * Indices of the caption's punchline words, from the punchline pass. Absent
   * when no pass has run or the text was edited; both fall back to a local pick.
   */
  punchlineWordIndices?: number[];
  /** This cue's own position; falls back to the style's default when absent. */
  placement?: CaptionPlacement;
  /** This cue's own font scale; falls back to the style's `scale` when absent. */
  scale?: number;
};

export type Transcript = {
  language?: string;
  /** Source of truth. */
  words: Word[];
  /** Derived from `words`, then edited by the user. */
  captions: Caption[];
};
