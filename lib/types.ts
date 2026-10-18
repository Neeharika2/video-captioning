/** One spoken word with times in seconds. */
export type Word = {
  text: string;
  start: number;
  end: number;
  speaker?: string;
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
};

export type Transcript = {
  language?: string;
  /** Source of truth. */
  words: Word[];
  /** Derived from `words`, then edited by the user. */
  captions: Caption[];
};
