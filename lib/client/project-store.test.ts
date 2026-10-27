import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE } from "@/lib/caption-style";
import {
  formatBytes,
  formatDuration,
  newProjectId,
  sortProjects,
  toSummary,
  type ProjectSummary,
  type SavedProject,
} from "./project-store";

function project(over: Partial<SavedProject> = {}): SavedProject {
  return {
    id: "p1",
    name: "clip.mp4",
    createdAt: 1,
    updatedAt: 2,
    bytes: 1024,
    mimeType: "video/mp4",
    hasVideo: true,
    settings: { style: DEFAULT_STYLE, script: "roman", glossary: "", speakers: false },
    words: [{ text: "Hello", start: 0, end: 0.4 }],
    spelled: null,
    result: null,
    punchlines: {},
    captionEdits: {},
    captionTimings: {},
    captionPlacements: {},
    captionScales: {},
    ...over,
  };
}

describe("toSummary", () => {
  it("keeps the card fields and counts the words", () => {
    const s = toSummary(project({ durationSec: 12.5, thumbnail: "data:image/jpeg;base64,xx" }));
    expect(s).toEqual({
      id: "p1",
      name: "clip.mp4",
      createdAt: 1,
      updatedAt: 2,
      bytes: 1024,
      durationSec: 12.5,
      thumbnail: "data:image/jpeg;base64,xx",
      hasVideo: true,
      wordCount: 1,
    });
    // The transcript itself never reaches the library grid.
    expect("words" in s).toBe(false);
  });

  it("reports zero words for a project whose transcript was empty", () => {
    expect(toSummary(project({ words: [] })).wordCount).toBe(0);
  });
});

describe("sortProjects", () => {
  const summary = (id: string, updatedAt: number): ProjectSummary => ({
    id,
    name: id,
    createdAt: 0,
    updatedAt,
    bytes: 0,
    hasVideo: false,
    wordCount: 0,
  });

  it("puts the most recently edited project first without mutating the input", () => {
    const input = [summary("a", 10), summary("b", 30), summary("c", 20)];
    expect(sortProjects(input).map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(input.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("formatBytes", () => {
  it("scales through the units and trims precision as the number grows", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(200 * 1024)).toBe("200 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.50 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.00 GB");
  });

  it("never runs past terabytes or returns NaN", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(1024 ** 5)).toBe("1024 TB");
  });
});

describe("formatDuration", () => {
  it("shows m:ss past a minute and whole seconds below it", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(67)).toBe("1:07");
    expect(formatDuration(187.4)).toBe("3:07");
  });

  it("is empty when there is nothing to show", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

describe("newProjectId", () => {
  it("hands out a fresh, non-empty id each time", () => {
    const a = newProjectId();
    const b = newProjectId();
    expect(a).toMatch(/\S/);
    expect(a).not.toBe(b);
  });
});
