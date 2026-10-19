import { describe, expect, it } from "vitest";
import { detectLanguage, formatLanguage } from "./detect-language";

const words = (text: string) => text.split(/\s+/);

describe("detectLanguage", () => {
  it("names the language when the script belongs to one", () => {
    expect(detectLanguage(words("ఎలా ఉన్నారు అందరూ"))).toEqual({ script: "Telugu", language: "Telugu" });
    expect(detectLanguage(words("안녕하세요"))).toEqual({ script: "Hangul", language: "Korean" });
  });

  it("reports shared scripts without guessing a language", () => {
    // Devanagari: Hindi or Marathi. Latin: English or Spanish.
    expect(detectLanguage(words("आप कैसे हैं"))).toEqual({ script: "Devanagari", language: null });
    expect(detectLanguage(words("तुम्ही कसे आहात"))).toEqual({ script: "Devanagari", language: null });
    expect(detectLanguage(words("hello everyone welcome back"))).toEqual({ script: "Latin", language: null });
    expect(detectLanguage(words("hola a todos bienvenidos"))).toEqual({ script: "Latin", language: null });
    expect(detectLanguage(words("كيف حالك"))).toEqual({ script: "Arabic", language: null });
    expect(detectLanguage(words("привет"))).toEqual({ script: "Cyrillic", language: null });
  });

  it("picks the dominant script in code-switched speech", () => {
    // Telugu sentence with one English word: Telugu wins.
    expect(detectLanguage(words("మా అమ్మ చాలా బాగా వంట చేస్తుంది video"))?.script).toBe("Telugu");
    // English sentence with one Telugu word: Latin wins.
    expect(detectLanguage(words("today the video is చాలా good"))?.script).toBe("Latin");
  });

  it("treats kana-plus-kanji as Japanese but bare kanji as Chinese", () => {
    expect(detectLanguage(words("こんにちは"))?.language).toBe("Japanese");
    expect(detectLanguage(words("私は日本語"))?.language).toBe("Japanese");
    expect(detectLanguage(words("你好世界"))?.language).toBe("Chinese");
  });

  it("returns null when there are no letters yet", () => {
    expect(detectLanguage([])).toBeNull();
    expect(detectLanguage(["", "   ", "12 — 34"])).toBeNull();
  });
});

describe("formatLanguage", () => {
  it("joins language and script", () => {
    expect(formatLanguage({ script: "Hangul", language: "Korean" })).toBe("Korean · Hangul");
  });

  it("shows the name once when language and script share it", () => {
    expect(formatLanguage({ script: "Telugu", language: "Telugu" })).toBe("Telugu");
  });

  it("shows the script alone when the language is ambiguous", () => {
    expect(formatLanguage({ script: "Latin", language: null })).toBe("Latin script");
  });
});
