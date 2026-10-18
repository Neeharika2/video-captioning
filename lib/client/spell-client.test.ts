import { describe, expect, it } from "vitest";
import { planBatches } from "./spell-client";

describe("planBatches", () => {
  it("covers every word exactly once", () => {
    const words = Array.from({ length: 1234 }, (_, i) => `w${i}`);
    const batches = planBatches(words, 250);
    expect(batches[0].start).toBe(0);
    expect(batches.at(-1)!.end).toBe(1234);
    for (let i = 1; i < batches.length; i++) expect(batches[i].start).toBe(batches[i - 1].end);
    for (const b of batches) expect(b.end - b.start).toBeLessThanOrEqual(250);
  });

  it("prefers to end a batch at a sentence end", () => {
    const words = Array.from({ length: 30 }, (_, i) => (i === 21 ? "end." : `w${i}`));
    expect(planBatches(words, 25)[0]).toEqual({ start: 0, end: 22 });
  });

  it("handles short and empty input", () => {
    expect(planBatches(["a", "b"], 250)).toEqual([{ start: 0, end: 2 }]);
    expect(planBatches([], 250)).toEqual([]);
  });
});
