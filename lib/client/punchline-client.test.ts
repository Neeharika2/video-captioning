import { describe, expect, it } from "vitest";
import { planCaptionBatches } from "./punchline-client";

describe("planCaptionBatches", () => {
  it("covers every caption exactly once", () => {
    const captions = Array.from({ length: 123 }, () => ["a", "b"]);
    const batches = planCaptionBatches(captions, 40);
    expect(batches[0].start).toBe(0);
    expect(batches.at(-1)!.end).toBe(123);
    for (let i = 1; i < batches.length; i++) expect(batches[i].start).toBe(batches[i - 1].end);
    for (const b of batches) expect(b.end - b.start).toBeLessThanOrEqual(40);
  });

  it("handles short and empty input", () => {
    expect(planCaptionBatches([["hi"]], 40)).toEqual([{ start: 0, end: 1 }]);
    expect(planCaptionBatches([], 40)).toEqual([]);
  });
});
