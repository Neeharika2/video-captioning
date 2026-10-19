import { describe, expect, it } from "vitest";
import {
  coverageRatio,
  coveredRanges,
  findCoverageGaps,
  mergeWords,
  planWindows,
  splitRange,
} from "./caption-coverage";
import type { Word } from "../types";

const w = (start: number, end: number, text = "x"): Word => ({ text, start, end });

describe("coveredRanges", () => {
  it("clamps to the range and merges overlaps and touches", () => {
    expect(coveredRanges([w(-1, 1), w(0.9, 2), w(1.9, 3), w(4, 5)], 0, 10)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it("drops zero-length words and words outside the range", () => {
    expect(coveredRanges([w(2, 2), w(20, 21)], 0, 10)).toEqual([]);
  });
});

describe("findCoverageGaps", () => {
  it("finds the leading, middle and trailing gaps", () => {
    const words = [w(3, 4), w(8, 9)];
    expect(findCoverageGaps(words, 0, 15, 2.5)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 8 },
      { start: 9, end: 15 },
    ]);
  });

  it("ignores gaps shorter than the minimum", () => {
    // The 1s gaps at each end are small; the 3s middle one is not.
    expect(findCoverageGaps([w(1, 3), w(6, 9)], 0, 10, 2.5)).toEqual([{ start: 3, end: 6 }]);
  });

  it("returns the whole range when nothing was transcribed", () => {
    expect(findCoverageGaps([], 3, 9, 2.5)).toEqual([{ start: 3, end: 9 }]);
  });

  it("returns nothing for an empty range", () => {
    expect(findCoverageGaps([], 5, 5)).toEqual([]);
  });
});

describe("coverageRatio", () => {
  it("measures the covered share", () => {
    expect(coverageRatio([w(0, 1), w(1, 2), w(3, 4)], 0, 4)).toBeCloseTo(0.75);
    expect(coverageRatio([], 0, 4)).toBe(0);
    expect(coverageRatio([w(0, 10)], 0, 10)).toBe(1);
  });

  it("treats an empty range as fully covered", () => {
    expect(coverageRatio([], 4, 4)).toBe(1);
  });
});

describe("splitRange", () => {
  it("halves a range at its midpoint", () => {
    expect(splitRange({ start: 2, end: 6 })).toEqual([
      { start: 2, end: 4 },
      { start: 4, end: 6 },
    ]);
  });
});

describe("planWindows", () => {
  it("splits into equal windows no longer than maxLen, ending on the range end", () => {
    const windows = planWindows({ start: 0, end: 50 }, 20);
    expect(windows).toHaveLength(3);
    for (const win of windows) expect(win.end - win.start).toBeLessThanOrEqual(20 + 1e-9);
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBe(50);
  });

  it("keeps a short range whole", () => {
    expect(planWindows({ start: 1, end: 5 }, 20)).toEqual([{ start: 1, end: 5 }]);
  });
});

describe("mergeWords", () => {
  it("sorts chunks onto one timeline", () => {
    const merged = mergeWords([
      [w(4, 5, "b")],
      [w(1, 2, "a")],
    ]);
    expect(merged.map((x) => x.text)).toEqual(["a", "b"]);
  });

  it("drops the seam duplicate, keeping the longer timing", () => {
    const merged = mergeWords([
      [w(1, 2, "hello"), w(3, 4, "world")],
      [w(1.1, 2.5, "hello!")], // same word heard again by the next chunk
    ]);
    expect(merged.filter((x) => x.text.toLowerCase().startsWith("hello"))).toEqual([
      { text: "hello!", start: 1.1, end: 2.5 },
    ]);
    expect(merged.map((x) => x.text)).toEqual(["hello!", "world"]);
  });

  it("keeps distinct words that merely overlap in time", () => {
    const merged = mergeWords([[w(1, 2, "a"), w(1.2, 2.2, "b")]]);
    expect(merged.map((x) => x.text)).toEqual(["a", "b"]);
  });

  it("ignores empty and zero-length words", () => {
    expect(mergeWords([[w(1, 2, "  "), w(3, 3, "x"), w(4, 5, "ok")]])).toEqual([w(4, 5, "ok")]);
  });
});
