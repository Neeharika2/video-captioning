/**
 * Read the spoken language of a transcript from the scripts its letters use.
 *
 * Gemini transcribes each language in its own script, so the dominant Unicode
 * script says something about the language even though the app never pins a
 * language up front. This is a read-only label for the editor; nothing is sent
 * back to the API.
 *
 * A language is only named when its script belongs to essentially one
 * language (Telugu, Korean, Thai…). Scripts shared by many languages — Latin,
 * Cyrillic, Arabic, Devanagari, Bengali — are reported by script alone, so a
 * Spanish video never reads as "English" or a Marathi one as "Hindi".
 */

export type DetectedLanguage = {
  /** Unicode script family, e.g. "Devanagari". */
  script: string;
  /** Human name when the script implies one language, e.g. "Telugu"; otherwise null. */
  language: string | null;
};

type ScriptDef = { script: string; language: string | null };

/** Scripts the transcription model can realistically return. */
const SCRIPTS: ScriptDef[] = [
  { script: "Devanagari", language: null }, // Hindi, Marathi, Nepali…
  { script: "Telugu", language: "Telugu" },
  { script: "Tamil", language: "Tamil" },
  { script: "Kannada", language: "Kannada" },
  { script: "Malayalam", language: "Malayalam" },
  { script: "Bengali", language: null }, // Bengali, Assamese
  { script: "Gujarati", language: "Gujarati" },
  { script: "Gurmukhi", language: "Punjabi" },
  { script: "Oriya", language: "Odia" },
  { script: "Arabic", language: null }, // Arabic, Urdu, Persian…
  { script: "Hebrew", language: "Hebrew" },
  { script: "Cyrillic", language: null }, // Russian, Ukrainian, Bulgarian…
  { script: "Greek", language: "Greek" },
  { script: "Thai", language: "Thai" },
  { script: "Hangul", language: "Korean" },
  { script: "Hiragana", language: "Japanese" },
  { script: "Katakana", language: "Japanese" },
  { script: "Han", language: "Chinese" },
  { script: "Latin", language: null }, // English, Spanish, French, Indonesian…
];

const PATTERNS = SCRIPTS.map((s) => new RegExp(`\\p{Script=${s.script}}`, "u"));

/**
 * Dominant script (and its language, when unambiguous) across the given word strings.
 * Returns null when there are no letters to look at (e.g. before transcription).
 */
export function detectLanguage(texts: readonly string[]): DetectedLanguage | null {
  const counts = new Map<string, number>();
  let kana = false;

  for (const text of texts) {
    for (const ch of text) {
      for (let i = 0; i < SCRIPTS.length; i++) {
        if (!PATTERNS[i].test(ch)) continue;
        const s = SCRIPTS[i];
        counts.set(s.script, (counts.get(s.script) ?? 0) + 1);
        if (s.script === "Hiragana" || s.script === "Katakana") kana = true;
        break;
      }
    }
  }

  let top: ScriptDef | null = null;
  let topCount = 0;
  for (const s of SCRIPTS) {
    const n = counts.get(s.script) ?? 0;
    if (n > topCount) {
      top = s;
      topCount = n;
    }
  }
  if (!top) return null;
  // Any kana at all means Japanese, even when kanji (Han) outnumber it.
  if (kana && top.script === "Han") top = SCRIPTS.find((s) => s.script === "Hiragana") ?? top;

  return { script: top.script, language: top.language };
}

/** "Korean · Hangul", "Telugu", or "Latin script" — the readout shown next to a transcript. */
export function formatLanguage(lang: DetectedLanguage): string {
  if (!lang.language) return `${lang.script} script`;
  return lang.language === lang.script ? lang.language : `${lang.language} · ${lang.script}`;
}
