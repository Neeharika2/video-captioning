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

  it("upper- or lowercases before measuring", () => {
    const upper = layoutCaption({ ...DEFAULT_STYLE, textCase: "upper" }, cue("hello world", ["hello", "world"]), 1000, 1000, measure);
    expect(upper.lines).toEqual(["HELLO", "WORLD"]);
    const lower = layoutCaption({ ...DEFAULT_STYLE, textCase: "lower" }, cue("Hello World", ["Hello", "World"]), 1000, 1000, measure);
    expect(lower.lines).toEqual(["hello", "world"]);
  });

  it("measures weight-shift captions at the bold weight", () => {
    const fonts: string[] = [];
    layoutCaption({ ...DEFAULT_STYLE, emphasis: "weight", weight: 300 }, cue("hello"), 1000, 1000, (text, font) => {
      fonts.push(font);
      return measure(text, font);
    });
    expect(fonts.every((f) => f.startsWith("800 "))).toBe(true);
  });

  it("adds a smaller line in the other script for bilingual captions", () => {
    const c: Caption = {
      ...cue("ela unnaru"),
      words: [
        { text: "ela", start: 0, end: 0.5, alt: "ఎలా" },
        { text: "unnaru", start: 0.5, end: 1, alt: "ఉన్నారు" },
      ],
    };
    const layout = layoutCaption({ ...DEFAULT_STYLE, bilingual: true }, c, 1000, 1000, measure);
    expect(layout.sub?.lines).toEqual(["ఎలా ఉన్నారు"]);
    expect(layout.sub!.fontSize).toBeLessThan(layout.fontSize);
    // Off, or nothing different to show: no second line.
    expect(layoutCaption(DEFAULT_STYLE, c, 1000, 1000, measure).sub).toBeUndefined();
    expect(layoutCaption({ ...DEFAULT_STYLE, bilingual: true }, { ...c, text: "edited" }, 1000, 1000, measure).sub).toBeUndefined();
    const same: Caption = { ...c, words: c.words.map((w) => ({ ...w, alt: w.text })) };
    expect(layoutCaption({ ...DEFAULT_STYLE, bilingual: true }, same, 1000, 1000, measure).sub).toBeUndefined();
  });

  it("wraps greedily at word boundaries", () => {
    const lines = wrapToWidth("aa bb cc", 5, (text) => text.length);
    expect(lines).toEqual(["aa bb", "cc"]);
    expect(wrapToWidth("short", 20, (text) => text.length)).toEqual(["short"]);
  });
});
