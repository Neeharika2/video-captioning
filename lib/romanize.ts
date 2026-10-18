/**
 * Write Indian-language text in English letters, the way people type it in
 * chats: "ఎలా ఉన్నారు అందరూ" → "ela unnaru andharu".
 *
 * Rule-based and per character, so each word maps to exactly one word and
 * keeps its timing. Text already in Latin script (code-mixed English) passes
 * through unchanged. Tuned for Telugu; other Indic scripts get the same
 * casual scheme with small per-language adjustments.
 *
 * All Indic Unicode blocks share one layout (KA is always block + 0x15, etc.),
 * so one table covers them; profiles hold the differences.
 */
import type { Word } from "./types";

type Profile = {
  /** Vowel a consonant carries when no vowel sign follows. */
  inherent: string;
  /** Drop the inherent vowel at the end of a word (Hindi "kamal", not "kamala"). */
  dropFinalInherent: boolean;
  /** Anusvara at the end of a word: Telugu "namaskaram", Hindi "hain". */
  finalAnusvara: string;
  candrabindu: string;
  /** Long ā/ī/ū/ṛ, by position. */
  vowels: { aa: string; aaInitial: string; ii: string; iiInitial: string; iiFinal: string; uu: string; uuInitial: string; r: string };
  /** Long ā is "aa" in a word's first syllable: baagunnara, naaku, chaala (but ela, unnaru). */
  longAaInFirstSyllable: boolean;
  /** Dental త/ద written "th"/"dh" (South Indian habit) and doubled as "tt"/"dd". */
  dentalH: boolean;
  /** Per-offset consonant/vowel overrides. */
  overrides?: Record<number, string>;
};

const SOUTH: Profile = {
  inherent: "a",
  dropFinalInherent: false,
  finalAnusvara: "m",
  candrabindu: "",
  vowels: { aa: "a", aaInitial: "aa", ii: "ee", iiInitial: "ee", iiFinal: "i", uu: "u", uuInitial: "oo", r: "ru" },
  longAaInFirstSyllable: true,
  dentalH: true,
};

const NORTH: Profile = {
  inherent: "a",
  dropFinalInherent: true,
  finalAnusvara: "n",
  candrabindu: "n",
  vowels: { aa: "a", aaInitial: "aa", ii: "i", iiInitial: "i", iiFinal: "i", uu: "u", uuInitial: "u", r: "ri" },
  longAaInFirstSyllable: false,
  dentalH: false,
};

const EAST: Profile = {
  ...NORTH,
  inherent: "o",
  overrides: { 0x10: "oi", 0x14: "ou", 0x48: "oi", 0x4c: "ou", 0x2f: "j", 0x36: "sh", 0x37: "sh", 0x38: "sh" },
};

const BLOCKS: { start: number; profile: Profile }[] = [
  { start: 0x0900, profile: NORTH }, // Devanagari: Hindi, Marathi
  { start: 0x0980, profile: EAST }, // Bengali, Assamese
  { start: 0x0a00, profile: { ...NORTH, overrides: { 0x59: "kh", 0x5a: "g", 0x5b: "z", 0x5c: "r", 0x5e: "f" } } }, // Gurmukhi
  { start: 0x0a80, profile: NORTH }, // Gujarati
  { start: 0x0b00, profile: { ...EAST, overrides: { ...EAST.overrides, 0x5c: "r", 0x5d: "rh", 0x5f: "y" } } }, // Odia
  { start: 0x0b80, profile: { ...SOUTH, overrides: { 0x1f: "d", 0x31: "r", 0x29: "n" } } }, // Tamil
  { start: 0x0c00, profile: { ...SOUTH, overrides: { 0x58: "ts", 0x59: "dz", 0x5a: "r", 0x5d: "n" } } }, // Telugu
  { start: 0x0c80, profile: SOUTH }, // Kannada
  { start: 0x0d00, profile: { ...SOUTH, overrides: { 0x57: "au" } } }, // Malayalam
];

const CONSONANTS: Record<number, string> = {
  0x15: "k", 0x16: "kh", 0x17: "g", 0x18: "gh", 0x19: "n",
  0x1a: "ch", 0x1b: "chh", 0x1c: "j", 0x1d: "jh", 0x1e: "ny",
  0x1f: "t", 0x20: "th", 0x21: "d", 0x22: "dh", 0x23: "n",
  0x24: "t", 0x25: "th", 0x26: "d", 0x27: "dh", 0x28: "n", 0x29: "n",
  0x2a: "p", 0x2b: "ph", 0x2c: "b", 0x2d: "bh", 0x2e: "m",
  0x2f: "y", 0x30: "r", 0x31: "r", 0x32: "l", 0x33: "l", 0x34: "zh", 0x35: "v",
  0x36: "sh", 0x37: "sh", 0x38: "s", 0x39: "h",
  // Devanagari/Bengali precomposed nukta letters (Telugu etc. override these)
  0x58: "q", 0x59: "kh", 0x5a: "g", 0x5b: "z", 0x5c: "r", 0x5d: "rh", 0x5e: "f", 0x5f: "y",
};

/** Malayalam chillu letters: consonants with no vowel. */
const CHILLU: Record<number, string> = { 0x7a: "n", 0x7b: "n", 0x7c: "r", 0x7d: "l", 0x7e: "l", 0x7f: "k" };

/** Consonant + nukta → sound (क़ q, ज़ z, फ़ f, ड़ r …). */
const NUKTA: Record<number, string> = { 0x15: "q", 0x16: "kh", 0x17: "g", 0x1c: "z", 0x21: "r", 0x22: "rh", 0x2b: "f", 0x2f: "y" };

type VowelKey = "a" | "aa" | "i" | "ii" | "u" | "uu" | "r" | "l" | "e" | "ai" | "o" | "au";
const INDEPENDENT: Record<number, VowelKey> = {
  0x05: "a", 0x06: "aa", 0x07: "i", 0x08: "ii", 0x09: "u", 0x0a: "uu", 0x0b: "r", 0x0c: "l",
  0x0d: "e", 0x0e: "e", 0x0f: "e", 0x10: "ai", 0x11: "o", 0x12: "o", 0x13: "o", 0x14: "au",
  0x60: "r", 0x61: "l",
};
const SIGNS: Record<number, VowelKey> = {
  0x3e: "aa", 0x3f: "i", 0x40: "ii", 0x41: "u", 0x42: "uu", 0x43: "r", 0x44: "r",
  0x45: "e", 0x46: "e", 0x47: "e", 0x48: "ai", 0x49: "o", 0x4a: "o", 0x4b: "o", 0x4c: "au",
  0x62: "l", 0x63: "l",
};

const VIRAMA = 0x4d;
const NUKTA_SIGN = 0x3c;
const ANUSVARA = 0x02;
const GURMUKHI_TIPPI = 0x70;
const GURMUKHI_ADDAK = 0x71;
/** Ignored: avagraha, length marks, Gurmukhi vowel carriers, Tamil/Kannada AU length marks. */
const SILENT = new Set([0x3d, 0x55, 0x56, 0x72, 0x73]);
const JOINERS = /[‌‍]/g;

function blockOf(cp: number) {
  for (const b of BLOCKS) if (cp >= b.start && cp < b.start + 0x80) return b;
  return undefined;
}

/** Part of an Indic word (letter or sign), as opposed to space/punctuation/Latin. */
function isWordChar(cp: number | undefined) {
  if (cp === undefined) return false;
  const b = blockOf(cp);
  if (!b) return false;
  const o = cp - b.start;
  return !(o === 0x64 || o === 0x65 || (o >= 0x66 && o <= 0x6f));
}

function isConsonant(o: number) {
  return (o >= 0x15 && o <= 0x39) || (o >= 0x58 && o <= 0x5f);
}

function vowel(key: VowelKey, p: Profile, initial: boolean, final: boolean, offset: number): string {
  const override = p.overrides?.[offset];
  if (override !== undefined) return override;
  const v = p.vowels;
  switch (key) {
    case "aa":
      return initial ? v.aaInitial : v.aa;
    case "ii":
      return initial ? v.iiInitial : final ? v.iiFinal : v.ii;
    case "uu":
      return initial ? v.uuInitial : v.uu;
    case "r":
      return v.r;
    case "l":
      return "lu";
    case "a":
      return p.inherent === "o" ? "o" : "a";
    default:
      return key;
  }
}

function consonant(o: number, p: Profile): string {
  const override = p.overrides?.[o];
  if (override !== undefined) return override;
  if (p.dentalH && (o === 0x24 || o === 0x26)) return CONSONANTS[o] + "h";
  return CONSONANTS[o] ?? "";
}

type Pending = { roman: string; profile: Profile };

/** Romanize one string. Non-Indic characters are copied through. */
export function romanize(text: string): string {
  const cps = Array.from(text.normalize("NFC").replace(JOINERS, ""), (c) => c.codePointAt(0)!);
  const st = {
    out: "",
    /** A consonant waiting to see whether a vowel sign or virama follows. */
    pending: null as Pending | null,
    wordStart: true,
    /** Syllables so far in this word (for dropping a final inherent vowel). */
    syllables: 0,
    /** Set by a virama between two identical consonants (or Gurmukhi addak). */
    geminate: false,
  };

  const flush = (atWordEnd: boolean) => {
    const pend = st.pending;
    if (!pend) return;
    st.out += pend.roman;
    if (!(atWordEnd && pend.profile.dropFinalInherent && st.syllables > 1)) st.out += pend.profile.inherent;
    st.pending = null;
  };
  const endWord = () => {
    flush(true);
    st.wordStart = true;
    st.syllables = 0;
  };

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    const block = blockOf(cp);
    if (!block) {
      const ch = String.fromCodePoint(cp);
      if (/[\s\p{P}\p{S}]/u.test(ch)) endWord();
      else {
        flush(true);
        st.wordStart = false;
      }
      st.out += ch;
      continue;
    }

    const p = block.profile;
    const o = cp - block.start;
    const next = cps[i + 1];
    const nextBlock = next === undefined ? undefined : blockOf(next);
    const nextOffset = nextBlock && next !== undefined ? next - nextBlock.start : -1;
    const atWordEnd = !isWordChar(next);

    if (isConsonant(o)) {
      flush(false);
      let roman = nextOffset === NUKTA_SIGN && NUKTA[o] ? NUKTA[o] : consonant(o, p);
      if (st.geminate && roman) {
        // త్త → "tt", ద్ద → "dd" (no h); others repeat the first letter: "kk", "nn", "cch".
        const dental = p.dentalH && (o === 0x24 || o === 0x26) && roman.endsWith("h");
        roman = dental ? roman[0] + roman[0] : roman[0] + roman;
      }
      st.geminate = false;
      st.pending = { roman, profile: p };
      st.syllables++;
      st.wordStart = false;
    } else if (block.start === 0x0d00 && o in CHILLU) {
      flush(false);
      st.out += CHILLU[o];
      st.wordStart = false;
    } else if (o in SIGNS) {
      const firstAa = SIGNS[o] === "aa" && p.longAaInFirstSyllable && st.syllables === 1;
      const v = firstAa ? "aa" : vowel(SIGNS[o], p, false, atWordEnd, o);
      if (st.pending) st.out += st.pending.roman;
      st.pending = null;
      st.out += v;
    } else if (o === VIRAMA) {
      const pend = st.pending;
      if (pend) {
        st.pending = null;
        st.syllables--;
        if (next !== undefined && next === cps[i - 1]) st.geminate = true;
        else st.out += pend.roman;
      }
    } else if (o in INDEPENDENT) {
      flush(false);
      st.out += vowel(INDEPENDENT[o], p, st.wordStart, atWordEnd, o);
      st.syllables++;
      st.wordStart = false;
    } else if (o === ANUSVARA || (block.start === 0x0a00 && o === GURMUKHI_TIPPI)) {
      flush(false);
      // n before k/ch/t/d/n-type sounds; m before p/b/m and the rest (samsaram, simham).
      if (atWordEnd) st.out += p.finalAnusvara;
      else st.out += nextOffset >= 0x15 && nextOffset <= 0x29 ? "n" : "m";
    } else if (o === 0x01) {
      flush(false);
      st.out += p.candrabindu;
    } else if (o === 0x03) {
      flush(false);
      st.out += "h";
    } else if (block.start === 0x0a00 && o === GURMUKHI_ADDAK) {
      flush(false);
      st.geminate = true;
    } else if (o === 0x64 || o === 0x65) {
      endWord();
      st.out += ".";
    } else if (o >= 0x66 && o <= 0x6f) {
      flush(true);
      st.out += String(o - 0x66);
    } else if (o === NUKTA_SIGN || SILENT.has(o)) {
      // Nukta was applied with its consonant; the rest have no sound.
    } else {
      flush(false);
    }
  }
  flush(true);
  return st.out;
}

const INDIC = /[ऀ-ൿ]/;

export function hasIndicScript(text: string) {
  return INDIC.test(text);
}

const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;

/** Contains letters of any script other than Latin (Telugu, Arabic, Cyrillic, CJK…). */
export function hasNonLatinLetters(text: string) {
  return NON_LATIN_LETTER.test(text);
}

/** Romanize each word's text; timings are unchanged. Scripts without rules are left as they are. */
export function romanizeWords(words: Word[]): Word[] {
  return words.map((w) => (INDIC.test(w.text) ? { ...w, text: romanize(w.text) } : w));
}
