import { describe, expect, it } from "vitest";
import { alignSequences, countEdits } from "./align";

const eq = (x: string, y: string) => x === y;
const ops = (a: string, b: string) =>
  alignSequences(a.split(" ").filter(Boolean), b.split(" ").filter(Boolean), eq).map((o) => o.op);

describe("alignSequences", () => {
  it("matches identical sequences", () => {
    expect(ops("a b c", "a b c")).toEqual(["match", "match", "match"]);
  });

  it("finds a substitution", () => {
    expect(ops("a b c", "a x c")).toEqual(["match", "sub", "match"]);
  });

  it("finds a deletion and an insertion", () => {
    expect(ops("a b c", "a c")).toEqual(["match", "del", "match"]);
    expect(ops("a c", "a b c")).toEqual(["match", "ins", "match"]);
  });

  it("handles empty inputs", () => {
    expect(ops("", "")).toEqual([]);
    expect(ops("a b", "")).toEqual(["del", "del"]);
    expect(ops("", "a b")).toEqual(["ins", "ins"]);
  });

  it("returns indices into both sequences", () => {
    const res = alignSequences(["x", "y"], ["y"], eq);
    expect(res).toEqual([
      { op: "del", a: "x", ai: 0 },
      { op: "match", a: "y", b: "y", ai: 1, bi: 0 },
    ]);
  });

  it("counts edits (edit distance)", () => {
    const res = alignSequences("kitten".split(""), "sitting".split(""), eq);
    expect(countEdits(res).edits).toBe(3);
  });
});
