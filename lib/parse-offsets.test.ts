import { describe, expect, it } from "vitest";
import { parseOffset } from "./parse-offsets";

describe("parseOffset", () => {
  it.each([
    ["0.100s", 0.1],
    ["0.450s", 0.45],
    ["12s", 12],
    ["3599.999s", 3599.999],
    [" 1.5s ", 1.5],
    ["-0.5s", -0.5],
  ])("parses %j", (input, expected) => {
    expect(parseOffset(input)).toBeCloseTo(expected, 9);
  });

  it.each(["", "0.1", "1.5ms", "abc", "1.s", ".5s"])("rejects %j", (input) => {
    expect(() => parseOffset(input)).toThrow(/Invalid duration/);
  });
});
