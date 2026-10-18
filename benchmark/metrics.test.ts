import { describe, expect, it } from "vitest";
import {
  charErrorRate,
  glossaryRecall,
  normalizeTokens,
  scriptAccuracy,
  timingError,
  wordErrorRate,
} from "./metrics";

describe("normalizeTokens", () => {
  it("lowercases, strips punctuation and apostrophes", () => {
    expect(normalizeTokens("Hello, world! Don't  stop—now.")).toEqual(["hello", "world", "dont", "stop", "now"]);
  });

  it("keeps Telugu combining marks", () => {
    expect(normalizeTokens("నమస్కారం, అందరికీ.")).toEqual(["నమస్కారం", "అందరికీ"]);
  });
});

describe("wordErrorRate", () => {
  it("is 0 for identical text modulo case/punctuation", () => {
    expect(wordErrorRate("Hello world.", "hello, world").rate).toBe(0);
  });

  it("counts substitutions, deletions and insertions", () => {
    const r = wordErrorRate("the cat sat on the mat", "the cat sit on mat today");
    expect(r.edits).toBe(3);
    expect(r.rate).toBeCloseTo(3 / 6);
    expect(wordErrorRate("a b c d", "a c d e")).toMatchObject({ sub: 0, del: 1, ins: 1, refLength: 4 });
    expect(wordErrorRate("a b c", "a x c")).toMatchObject({ sub: 1, del: 0, ins: 0 });
  });
});

describe("charErrorRate", () => {
  it("counts Telugu graphemes, not code points", () => {
    // "కీ" is one grapheme (2 code points).
    const r = charErrorRate("కీ", "కి");
    expect(r.refLength).toBe(1);
    expect(r.edits).toBe(1);
  });
});

describe("scriptAccuracy", () => {
  it("scores Telugu and Latin words separately", () => {
    const r = scriptAccuracy("నేను office కి వెళ్తాను", "నేను ఆఫీస్ కి వెళ్తాను");
    expect(r.latin).toBe(0);
    expect(r.telugu).toBe(1);
  });
});

describe("timingError", () => {
  it("pairs words by text and nearest start", () => {
    const truth = [
      { text: "hello", start: 1.0, end: 1.4 },
      { text: "world", start: 1.5, end: 2.0 },
      { text: "missing", start: 3, end: 3.5 },
    ];
    const hyp = [
      { text: "Hello,", start: 1.1, end: 1.45 },
      { text: "world", start: 1.8, end: 2.0 },
      { text: "world", start: 9, end: 9.5 },
    ];
    const r = timingError(truth, hyp);
    expect(r.matched).toBe(2);
    expect(r.total).toBe(3);
    expect(r.meanStartError).toBeCloseTo((0.1 + 0.3) / 2);
    expect(r.within150ms).toBe(0.5);
  });
});

describe("glossaryRecall", () => {
  it("counts glossary term occurrences found in the hypothesis", () => {
    const r = glossaryRecall(
      "We deploy to Kubernetes and query BigQuery. Kubernetes again.",
      "we deploy to cooper netties and query bigquery kubernetes again",
      ["Kubernetes", "BigQuery", "Terraform"],
    );
    expect(r).toEqual({ recall: 2 / 3, found: 2, expected: 3 });
  });
});
