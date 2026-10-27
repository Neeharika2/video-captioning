import { describe, expect, it } from "vitest";
import { buildPunchlinePrompt, reconcilePunchlines } from "./punchlines";

const CAPTIONS = [
  ["I", "made", "$5000"],
  ["in", "one", "week"],
  ["that", "is", "insane"],
];

describe("reconcilePunchlines", () => {
  it("accepts a well-formed answer and sorts the indices", () => {
    const r = reconcilePunchlines(CAPTIONS, {
      punchlines: [
        { id: 0, words: [2] },
        { id: 1, words: [2, 0] },
        { id: 2, words: [2] },
      ],
    });
    expect(r.rejections).toEqual([]);
    expect(r.punchlines).toEqual([[2], [0, 2], [2]]);
  });

  it("rejects missing, duplicated and reordered IDs", () => {
    const r = reconcilePunchlines(CAPTIONS, {
      punchlines: [
        { id: 0, words: [2] },
        { id: 0, words: [1] },
        { id: 2, words: [2] },
      ],
    });
    expect(r.punchlines[0]).toBeNull(); // duplicate
    expect(r.punchlines[1]).toBeNull(); // missing
    expect(r.punchlines[2]).toEqual([2]);
    expect(r.rejections).toEqual(
      expect.arrayContaining([
        { id: 0, reason: "duplicate" },
        { id: 1, reason: "missing" },
      ]),
    );

    const reordered = reconcilePunchlines(CAPTIONS, {
      punchlines: [
        { id: 0, words: [2] },
        { id: 2, words: [2] },
        { id: 1, words: [1] },
      ],
    });
    expect(reordered.punchlines[1]).toBeNull();
    expect(reordered.rejections).toContainEqual({ id: 1, reason: "out_of_order" });
  });

  it("drops a caption whose indices fall outside its words", () => {
    const r = reconcilePunchlines(CAPTIONS, {
      punchlines: [
        { id: 0, words: [3] },
        { id: 1, words: [1] },
        { id: 2, words: [2] },
      ],
    });
    expect(r.punchlines[0]).toBeNull();
    expect(r.rejections).toContainEqual({ id: 0, reason: "out_of_range" });
  });

  it("rejects empty, non-integer and too-many picks", () => {
    const inputs = [CAPTIONS[0], CAPTIONS[1], ["a", "b", "c", "d", "e"]];
    const r = reconcilePunchlines(inputs, {
      punchlines: [
        { id: 0, words: [] },
        { id: 1, words: ["1"] },
        { id: 2, words: [0, 1, 2, 3] },
      ],
    });
    expect(r.punchlines).toEqual([null, null, null]);
    expect(r.rejections.map((x) => x.reason)).toEqual(
      expect.arrayContaining(["empty", "out_of_range", "too_many"]),
    );
  });

  it("rejects everything on a malformed answer", () => {
    expect(reconcilePunchlines(CAPTIONS, { nope: true }).punchlines).toEqual([null, null, null]);
    expect(reconcilePunchlines(CAPTIONS, null).punchlines).toEqual([null, null, null]);
  });
});

describe("buildPunchlinePrompt", () => {
  it("numbers words inside each caption and lists the IDs to return", () => {
    const prompt = buildPunchlinePrompt({ captions: CAPTIONS.slice(0, 2) });
    expect(prompt).toContain("0\t0:I 1:made 2:$5000");
    expect(prompt).toContain("1\t0:in 1:one 2:week");
    expect(prompt).toContain("Return all 2 IDs, 0 to 1.");
  });

  it("includes read-only context without numbering it as a result", () => {
    const prompt = buildPunchlinePrompt({
      captions: [["hi"]],
      before: [["we", "were"]],
      after: [["bye"]],
    });
    expect(prompt).toContain("Context before (do not return): 0:we 1:were");
    expect(prompt).toContain("Context after (do not return): 0:bye");
    expect(prompt).toContain("0\t0:hi");
  });
});
