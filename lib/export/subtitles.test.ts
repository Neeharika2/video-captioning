import { describe, expect, it } from "vitest";
import type { Caption } from "../types";
import { formatTimestamp, toSrt, toVtt } from "./subtitles";

const cap = (start: number, end: number, text: string, lines?: string[]): Caption => ({
  id: text,
  start,
  end,
  text,
  words: [],
  lines,
});

describe("formatTimestamp", () => {
  it.each([
    [0, ",", "00:00:00,000"],
    [1.5, ",", "00:00:01,500"],
    [61.2345, ".", "00:01:01.235"],
    [3600 + 59.9999, ",", "01:01:00,000"],
    [-1, ".", "00:00:00.000"],
  ] as const)("%s → %s", (sec, sep, expected) => {
    expect(formatTimestamp(sec, sep)).toBe(expected);
  });
});

describe("toSrt", () => {
  it("numbers cues in time order and uses comma milliseconds", () => {
    const srt = toSrt([cap(3, 4, "Second"), cap(0.5, 2.25, "First line two", ["First line", "two"])]);
    expect(srt).toBe("1\n00:00:00,500 --> 00:00:02,250\nFirst line\ntwo\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\n");
  });

  it("skips empty and zero-length cues", () => {
    expect(toSrt([cap(1, 1, "x"), cap(1, 2, "  ")])).toBe("");
  });
});

describe("toVtt", () => {
  it("writes a header, dot milliseconds and escapes markup", () => {
    expect(toVtt([cap(1, 2.5, "a < b & c")])).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\na &lt; b &amp; c\n");
  });
});
