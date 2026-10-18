/**
 * "Smart spelling": a text-only Gemini pass that rewrites each transcribed
 * word in English letters (any language: Telugu, Hindi, Arabic, Russian,
 * Chinese…) and restores English words to normal spelling
 * (టాపిక్ → "topic", ఎల్ఎల్ఎమ్స్ → "LLMs", टॉपिक → "topic").
 *
 * Word timings come from transcription and must never move, so the model only
 * respells words one-for-one by ID. Everything it returns is checked here;
 * any word that fails a check keeps the rule-based spelling from romanize.ts.
 *
 * Shared by the server (prompt + checks) and the client (request types).
 */
import { z } from "zod";
import { LANGUAGE_CODE_RE, MAX_LANGUAGE_CODES } from "./api-types";
import { romanize } from "./romanize";

export const SPELL_PATH = "/api/spell";
/** Words corrected per request. Long transcripts are sent in batches. */
export const MAX_SPELL_WORDS = 300;
/** Neighbouring words sent as read-only context on each side of a batch. */
export const SPELL_CONTEXT_WORDS = 30;
export const MAX_GLOSSARY_TERMS = 200;
export const MAX_TERM_LENGTH = 60;
const MAX_WORD_LENGTH = 100;

export const SpellRequestSchema = z.object({
  /** The words to respell; a word's ID is its index here. */
  words: z.array(z.string().max(MAX_WORD_LENGTH)).min(1).max(MAX_SPELL_WORDS),
  /** Read-only context: the words just before and after this batch. */
  before: z.array(z.string().max(MAX_WORD_LENGTH)).max(SPELL_CONTEXT_WORDS).optional(),
  after: z.array(z.string().max(MAX_WORD_LENGTH)).max(SPELL_CONTEXT_WORDS).optional(),
  /** Terms that should come out spelled exactly like this (LLMs, Kubernetes). */
  glossary: z.array(z.string().trim().min(1).max(MAX_TERM_LENGTH)).max(MAX_GLOSSARY_TERMS).optional(),
  /** BCP-47 hints for the spoken languages, if the user gave any. */
  languages: z.array(z.string().regex(LANGUAGE_CODE_RE)).max(MAX_LANGUAGE_CODES).optional(),
});
export type SpellRequest = z.infer<typeof SpellRequestSchema>;

export type SpelledWord = {
  /** In English letters, with the original word's punctuation. */
  text: string;
  /** An English word/term (as opposed to a romanized word of the spoken language). */
  english: boolean;
};

export type SpellResponse = {
  /** One entry per request word; null = rejected, use the rule-based spelling. */
  words: (SpelledWord | null)[];
  rejected: number;
  model: string;
};

// ---------------------------------------------------------------------------
// Prompt

export const SPELL_SYSTEM_PROMPT = `You fix the spelling of an automatic speech transcript. The speaker may talk in any language (for example Telugu, Hindi, Tamil, Arabic, Russian, Japanese, Chinese), often mixed with English. The transcript is word by word, and every word has an ID and a start time that must not change.

The output must be entirely in English (Latin) letters.

For EVERY word ID you are given, return exactly one item with that same ID, in the same order. Never translate, never merge two IDs into one, never split an ID, never add, drop or reorder words.

For each word:
1. If the speaker said an ENGLISH word, acronym, brand or technical term (often written in the other language's script by mistake), set english=true and write it in normal English spelling and capitalisation. Examples: టాపిక్ → topic, ఎల్ఎల్ఎమ్స్ → LLMs, ఆఫీస్ → office, वीडियो → video, सब्सक्राइब → subscribe, மீட்டிங் → meeting, كمبيوتر → computer, компьютер → computer, ミーティング → meeting.
2. Otherwise set english=false and write the word in English letters the way native speakers casually type their language in chats, without translating:
   - Telugu: ఎలా → ela, ఉన్నారు → unnaru, అందరూ → andharu, బాగున్నారా → baagunnara, వస్తాను → vasthanu, ఈరోజు → eeroju, చాలా → chaala, నాకు → naaku, మీరు → meeru. A long ā is written "aa" in the word's first syllable and "a" elsewhere.
   - Hindi/Urdu: आप → aap, कैसे → kaise, है → hai, नहीं → nahi, کیا → kya
   - Tamil: எப்படி → eppadi, இருக்கீங்க → irukeenga; Kannada: ಹೇಗಿದ್ದೀರಾ → hegiddira; Malayalam: എന്താ → entha
   - Arabic: كيف → kif, حالك → halak, عندي → andi, مع → maa (letters only, never digits like 3, 7 or 5)
   - Russian and other Cyrillic: привет → privet, как → kak, дела → dela
   - Japanese: Hepburn romaji (ありがとう → arigatou); Chinese: pinyin without tone marks, syllables of one word joined (今天 → jintian, 你好 → nihao); Korean: 안녕하세요 → annyeonghaseyo
   - Any other language: its most common informal romanization.
3. A suffix or particle stuck to an English word stays in the same item: ఆఫీసుకి → office ki.
4. Keep the punctuation the word already has. Do not add new punctuation.
5. If a word sounds like a glossary term, use the glossary spelling exactly.
6. If a word is already in English letters and spelled correctly, return it unchanged.

Some input words come with a rule-based "hint" spelling. The hint is usually fine for native words and wrong for English ones.`;

export function buildSpellPrompt(req: SpellRequest): string {
  const lines: string[] = [];
  if (req.languages?.length) lines.push(`Expected languages: ${req.languages.join(", ")}`);
  if (req.glossary?.length) lines.push(`Glossary: ${req.glossary.join(", ")}`);
  if (lines.length) lines.push("");
  if (req.before?.length) lines.push(`Context before (do not return): ${req.before.join(" ")}`);
  lines.push(`Sentence(s) to fix: ${req.words.join(" ")}`);
  if (req.after?.length) lines.push(`Context after (do not return): ${req.after.join(" ")}`);
  lines.push("", "Words (id<TAB>word<TAB>hint, '-' = no hint):");
  req.words.forEach((w, id) => {
    const hint = romanize(w);
    lines.push(`${id}\t${w}\t${hint !== w ? hint : "-"}`);
  });
  lines.push("", `Return all ${req.words.length} IDs, 0 to ${req.words.length - 1}.`);
  return lines.join("\n");
}

/** JSON Schema for Gemini structured output. */
export const SPELL_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          text: { type: "string" },
          english: { type: "boolean" },
        },
        required: ["id", "text", "english"],
      },
    },
  },
  required: ["words"],
} as const;

export const ModelSpellOutputSchema = z.object({
  words: z.array(z.looseObject({ id: z.unknown(), text: z.unknown(), english: z.unknown() })),
});

// ---------------------------------------------------------------------------
// Checks

export type RejectReason =
  | "missing"
  | "duplicate"
  | "out_of_order"
  | "next_to_missing"
  | "empty"
  | "not_latin"
  | "too_many_words"
  | "too_long"
  | "sounds_different";

export type Reconciled = {
  words: (SpelledWord | null)[];
  rejections: { id: number; reason: RejectReason }[];
};

/** A letter in any script other than Latin. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;
const EDGE_PUNCT = /^([\p{P}\p{S}]*)([^]*?)([\p{P}\p{S}]*)$/u;

function splitPunct(s: string) {
  const m = EDGE_PUNCT.exec(s.trim())!;
  return { lead: m[1], core: m[2], trail: m[3] };
}

/**
 * Check the model's answer against the request, word by word. Returns a
 * spelling per input word, or null where the answer can't be trusted.
 */
export function reconcileSpelling(input: string[], output: unknown, glossary: string[] = []): Reconciled {
  const n = input.length;
  const rejections = new Map<number, RejectReason>();
  const reject = (id: number, reason: RejectReason) => {
    if (id >= 0 && id < n && !rejections.has(id)) rejections.set(id, reason);
  };

  const parsed = ModelSpellOutputSchema.safeParse(output);
  const items = parsed.success ? parsed.data.words : [];

  // Structure: every ID once, in order.
  const byId = new Map<number, { text: string; english: boolean }>();
  const seen = new Set<number>();
  let prev = -1;
  for (const item of items) {
    const id = item.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id >= n) continue;
    if (seen.has(id)) {
      byId.delete(id);
      reject(id, "duplicate");
      continue;
    }
    seen.add(id);
    if (id <= prev) {
      reject(id, "out_of_order");
      continue;
    }
    prev = id;
    byId.set(id, { text: typeof item.text === "string" ? item.text : "", english: item.english === true });
  }
  for (let id = 0; id < n; id++) {
    if (!seen.has(id)) {
      reject(id, "missing");
      // A missing word was often merged into a neighbour.
      reject(id - 1, "next_to_missing");
      reject(id + 1, "next_to_missing");
    }
  }

  const glossaryByKey = new Map(glossary.map((t) => [t.trim().toLowerCase(), t.trim()]));

  const words = input.map((original, id): SpelledWord | null => {
    if (rejections.has(id)) return null;
    const item = byId.get(id);
    if (!item) return reject(id, "missing"), null;

    const orig = splitPunct(original);
    let core = splitPunct(item.text).core.replace(/\s+/g, " ");
    if (!core) return reject(id, "empty"), null;
    if (NON_LATIN_LETTER.test(core)) return reject(id, "not_latin"), null;
    if (core.split(" ").length > 3) return reject(id, "too_many_words"), null;

    // Compare with what the word sounds like: the word itself if it was in
    // English letters, else its rule-based spelling. Scripts without rules
    // (Arabic, Cyrillic, CJK…) have no reference, so only the other checks apply.
    const ruleBased = romanize(orig.core);
    const reference = NON_LATIN_LETTER.test(ruleBased) ? null : ruleBased;
    const maxLength = reference ? reference.length * 2 + 10 : orig.core.length * 6 + 10;
    if (core.length > maxLength) return reject(id, "too_long"), null;
    if (reference && !soundsAlike(core, reference)) return reject(id, "sounds_different"), null;

    // Chat-style Arabic digits (3 = ع, 7 = ح …) → letters, unless the word had digits.
    if (/\p{L}\d|\d\p{L}/u.test(core) && !/\d/.test(original)) core = core.replace(/\d/g, (d) => ARABIZI[d] ?? d);

    const glossed = glossaryByKey.get(core.toLowerCase());
    if (glossed) core = glossed;
    // Punctuation always comes from the transcript, so sentence breaks stay put.
    return { text: `${latinPunctuation(orig.lead)}${core}${latinPunctuation(orig.trail)}`, english: item.english };
  });

  return { words, rejections: [...rejections].map(([id, reason]) => ({ id, reason })) };
}

const ARABIZI: Record<string, string> = { "2": "a", "3": "a", "5": "kh", "6": "t", "7": "h", "8": "gh", "9": "s" };

/** Script-specific punctuation → ASCII, for captions in English letters. */
export function latinPunctuation(s: string): string {
  return s.replace(/[。．｡]/g, ".").replace(/[、，،]/g, ",").replace(/[？؟]/g, "?").replace(/！/g, "!")
    .replace(/[：]/g, ":").replace(/[；؛]/g, ";").replace(/[「」『』“”]/g, '"').replace(/[।॥]/g, ".");
}

// ---------------------------------------------------------------------------
// "Sounds alike": catches translations ("roju" → "day") without blocking
// respellings ("tapik" → "topic", "elelems" → "LLMs").

const LETTER_NAMES: Record<string, string> = {
  A: "e", B: "bee", C: "see", D: "dee", E: "ee", F: "ef", G: "jee", H: "ech", I: "ai", J: "je",
  K: "ke", L: "el", M: "em", N: "en", O: "o", P: "pee", Q: "kyu", R: "ar", S: "es", T: "tee",
  U: "yu", V: "vee", W: "dablyu", X: "eks", Y: "vai", Z: "jed",
};

/** Consonant outline of a word, so different spellings of one sound match. */
export function consonantSkeleton(word: string): string {
  // Spell out acronyms the way they're pronounced: LLMs → el el em s
  let s = word.replace(/\b([A-Z]{2,})(s?)\b/g, (_, caps: string, plural: string) =>
    [...caps].map((c) => LETTER_NAMES[c] ?? c).join("") + plural,
  );
  s = s.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
  s = s
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kv")
    .replace(/x/g, "ks")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/h/g, "")
    .replace(/[aeiouy]/g, "")
    .replace(/(.)\1+/g, "$1");
  return s;
}

export function soundsAlike(a: string, b: string): boolean {
  const x = consonantSkeleton(a);
  const y = consonantSkeleton(b);
  const longest = Math.max(x.length, y.length);
  if (longest <= 1) return true; // vowel-only words ("ee", "a"): nothing to compare
  return levenshtein(x, y) <= Math.floor(longest / 2);
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** Glossary text box → clean term list (comma or newline separated, deduped). */
export function parseGlossary(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const term = raw.trim().slice(0, MAX_TERM_LENGTH);
    if (term && !seen.has(term.toLowerCase())) {
      seen.add(term.toLowerCase());
      out.push(term);
    }
  }
  return out.slice(0, MAX_GLOSSARY_TERMS);
}
