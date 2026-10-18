import { describe, expect, it } from "vitest";
import {
  buildSpellPrompt,
  consonantSkeleton,
  latinPunctuation,
  parseGlossary,
  reconcileSpelling,
  soundsAlike,
} from "./spelling";

const TELUGU = ["ఈ", "రోజు", "టాపిక్", "ఎల్ఎల్ఎమ్స్."];
const good = {
  words: [
    { id: 0, text: "ee", english: false },
    { id: 1, text: "roju", english: false },
    { id: 2, text: "topic", english: true },
    { id: 3, text: "LLMs.", english: true },
  ],
};

describe("reconcileSpelling", () => {
  it("accepts a well-formed answer", () => {
    const r = reconcileSpelling(TELUGU, good);
    expect(r.rejections).toEqual([]);
    expect(r.words.map((w) => w?.text)).toEqual(["ee", "roju", "topic", "LLMs."]);
    expect(r.words.map((w) => w?.english)).toEqual([false, false, true, true]);
  });

  it("rejects a missing word and both neighbours (likely merged)", () => {
    const merged = { words: [good.words[0], { id: 1, text: "roju topic", english: false }, good.words[3]] };
    const r = reconcileSpelling(TELUGU, merged);
    expect(r.words.map((w) => w?.text ?? null)).toEqual(["ee", null, null, null]);
    expect(r.rejections).toEqual(
      expect.arrayContaining([
        { id: 2, reason: "missing" },
        { id: 1, reason: "next_to_missing" },
        { id: 3, reason: "next_to_missing" },
      ]),
    );
  });

  it("rejects duplicated and reordered IDs", () => {
    const dup = { words: [...good.words, { id: 1, text: "day", english: true }] };
    expect(reconcileSpelling(TELUGU, dup).words[1]).toBeNull();
    const reordered = { words: [good.words[0], good.words[2], good.words[1], good.words[3]] };
    const r = reconcileSpelling(TELUGU, reordered);
    expect(r.words[1]).toBeNull();
    expect(r.words[2]?.text).toBe("topic");
  });

  it("rejects translations instead of respellings", () => {
    const translated = { words: good.words.map((w) => (w.id === 1 ? { ...w, text: "today" } : w)) };
    const r = reconcileSpelling(TELUGU, translated);
    expect(r.words[1]).toBeNull();
    expect(r.rejections).toContainEqual({ id: 1, reason: "sounds_different" });
  });

  it("rejects non-Latin output, empty text, and too many words", () => {
    const bad = {
      words: [
        { id: 0, text: "ఈ", english: false },
        { id: 1, text: " ", english: false },
        { id: 2, text: "topic is about the large models", english: true },
        good.words[3],
      ],
    };
    const r = reconcileSpelling(TELUGU, bad);
    expect(r.rejections.map((x) => x.reason)).toEqual(["not_latin", "empty", "too_many_words"]);
    expect(r.words[3]?.text).toBe("LLMs.");
  });

  it("rejects everything on a malformed answer", () => {
    expect(reconcileSpelling(TELUGU, { nope: true }).words).toEqual([null, null, null, null]);
    expect(reconcileSpelling(TELUGU, null).words).toEqual([null, null, null, null]);
  });

  it("takes punctuation from the transcript, converted to ASCII", () => {
    const r = reconcileSpelling(["ありがとう。", "كيف؟"], {
      words: [
        { id: 0, text: "arigatou!", english: false },
        { id: 1, text: "kif", english: false },
      ],
    });
    expect(r.words.map((w) => w?.text)).toEqual(["arigatou.", "kif?"]);
  });

  it("applies glossary casing and converts chat-style Arabic digits", () => {
    const r = reconcileSpelling(["కుబెర్నెటీస్", "عندي"], {
      words: [
        { id: 0, text: "kubernetes", english: true },
        { id: 1, text: "3andy", english: false },
      ],
    }, ["Kubernetes"]);
    expect(r.words.map((w) => w?.text)).toEqual(["Kubernetes", "aandy"]);
  });

  it("allows scripts without rule-based spelling (no sound check)", () => {
    const r = reconcileSpelling(["Привет,", "今天"], {
      words: [
        { id: 0, text: "Privet,", english: false },
        { id: 1, text: "jintian", english: false },
      ],
    });
    expect(r.words.map((w) => w?.text)).toEqual(["Privet,", "jintian"]);
  });

  it("checks words that were already in English letters against themselves", () => {
    const r = reconcileSpelling(["office", "LLMS"], {
      words: [
        { id: 0, text: "office", english: true },
        { id: 1, text: "LLMs", english: true },
      ],
    });
    expect(r.words.map((w) => w?.text)).toEqual(["office", "LLMs"]);
    const swapped = reconcileSpelling(["office"], { words: [{ id: 0, text: "workplace", english: true }] });
    expect(swapped.words[0]).toBeNull();
  });
});

describe("soundsAlike", () => {
  it.each([
    ["topic", "tapik", true],
    ["LLMs", "elelems", true],
    ["office", "aaphees", true],
    ["Kubernetes", "kubernetees", true],
    ["subscribe", "sabskraib", true],
    ["chaala", "chala", true],
    ["teliyadu", "theliyadhu", true],
    ["today", "roju", false],
    ["day", "roju", false],
    ["ee", "e", true],
  ] as const)("%s ~ %s → %s", (a, b, expected) => {
    expect(soundsAlike(a, b)).toBe(expected);
  });

  it("spells out acronyms", () => {
    expect(consonantSkeleton("LLMs")).toBe(consonantSkeleton("elelems"));
  });
});

describe("buildSpellPrompt", () => {
  it("numbers every word and adds rule-based hints, context and glossary", () => {
    const prompt = buildSpellPrompt({
      words: ["ఈ", "రోజు", "office"],
      before: ["నమస్కారం."],
      after: ["అండి"],
      glossary: ["LLMs"],
      languages: ["te-IN"],
    });
    expect(prompt).toContain("0\tఈ\tee");
    expect(prompt).toContain("1\tరోజు\troju");
    expect(prompt).toContain("2\toffice\t-");
    expect(prompt).toContain("Context before (do not return): నమస్కారం.");
    expect(prompt).toContain("Glossary: LLMs");
    expect(prompt).toContain("Expected languages: te-IN");
    expect(prompt).toContain("Return all 3 IDs, 0 to 2.");
  });
});

describe("helpers", () => {
  it("latinPunctuation", () => {
    expect(latinPunctuation("。、？！؟،")).toBe(".,?!?,");
  });

  it("parseGlossary dedupes and splits on commas and newlines", () => {
    expect(parseGlossary("LLMs, Kubernetes\nllms\n\n  React ")).toEqual(["LLMs", "Kubernetes", "React"]);
  });
});
