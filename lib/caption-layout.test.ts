import { describe, expect, it } from "vitest";
import { layoutCaption, wrapToWidth } from "./caption-layout";
import { DEFAULT_STYLE, fontSizeFor } from "./caption-style";
import type { Caption } from "./types";

/** Deterministic stand-in for canvas measureText: 0.5em per character. */
const measure = (text: string, font: string) => {
  const px = Number(/(\d+)px/.exec(font)?.[1] ?? 12);
  return text.length * px * 0.5;
};

const cue = (text: string, lines?: string[]): Caption => ({
  id: "cue-1",
  text,
  lines,
  start: 0,
  end: 1,
  words: [],
});

describe("caption layout", () => {
  it("keeps the editor's line breaks when they fit", () => {
    const layout = layoutCaption(
      { ...DEFAULT_STYLE, scale: 0.04 },
      cue("Hello everyone", ["Hello", "everyone"]),
      1000,
      1000,
      measure,
    );
    expect(layout.lines).toEqual(["Hello", "everyone"]);
    expect(layout.fontSize).toBe(fontSizeFor({ ...DEFAULT_STYLE, scale: 0.04 }, 1000, 1000));
  });

  it("re-wraps and shrinks when the preferred lines no longer fit", () => {
    const style = { ...DEFAULT_STYLE, scale: 0.08 };
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen";
    const long = cue(text, ["one two three four five six seven eight nine ten", "eleven twelve thirteen fourteen"]);
    const layout = layoutCaption(style, long, 1000, 1000, measure);
    // The editor lines would overflow at 80px, so it re-wraps…
    expect(layout.lines).not.toEqual(["one two three four five six seven eight nine ten", "eleven twelve thirteen fourteen"]);
    expect(layout.lines.join(" ")).toBe(text);
    // …and shrinks until it fits in at most three lines.
    expect(layout.lines.length).toBeLessThanOrEqual(3);
    expect(layout.fontSize).toBeLessThan(fontSizeFor(style, 1000, 1000));
  });

  it("uppercases before measuring and returns uppercase lines", () => {
    const layout = layoutCaption(
      { ...DEFAULT_STYLE, uppercase: true },
      cue("hello world", ["hello", "world"]),
      1000,
      1000,
      measure,
    );
    expect(layout.lines).toEqual(["HELLO", "WORLD"]);
  });

  it("wraps greedily at word boundaries", () => {
    const lines = wrapToWidth("aa bb cc", 5, (text) => text.length);
    expect(lines).toEqual(["aa bb", "cc"]);
    expect(wrapToWidth("short", 20, (text) => text.length)).toEqual(["short"]);
  });
});
