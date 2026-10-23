import { describe, expect, it } from "vitest";
import {
  REST,
  activeToken,
  canSplitLetters,
  contrastText,
  enterPose,
  glitchAmount,
  isRtl,
  letterStagger,
  loopBlockPose,
  motionPose,
  numberSpeakers,
  pickKeywords,
  shinePosition,
  splitGraphemes,
  tokenSpeakers,
  tokenTimings,
  waveOffset,
} from "./caption-effects";
import { ANIMATION_LABELS, WORD_MOTION_LABELS, type CaptionAnimation, type WordMotion } from "./caption-style";
import type { Caption } from "./types";

const ANIMATIONS = Object.keys(ANIMATION_LABELS) as CaptionAnimation[];
const MOTIONS = Object.keys(WORD_MOTION_LABELS) as WordMotion[];

const cue = (words: [string, number, number][], start = 0, end = 2): Caption => ({
  id: "c",
  text: words.map((w) => w[0]).join(" "),
  start,
  end,
  words: words.map(([text, s, e]) => ({ text, start: s, end: e })),
});

describe("entrances", () => {
  it("rest once finished, and on still frames", () => {
    for (const a of ANIMATIONS) {
      expect(enterPose(a, 1)).toBe(REST);
      expect(enterPose(a, Infinity)).toBe(REST);
      expect(enterPose(a, NaN)).toBe(REST);
    }
  });

  it("start visibly away from the resting pose", () => {
    for (const a of ANIMATIONS.filter((x) => x !== "none")) {
      const p = enterPose(a, 0);
      const moved = p.opacity < 1 || p.scale !== 1 || p.dx !== 0 || p.dy !== 0 || p.blur > 0;
      expect(moved, a).toBe(true);
    }
  });

  it("stay finite and non-negative all the way through", () => {
    for (const a of ANIMATIONS) {
      for (let i = 0; i <= 20; i++) {
        const p = enterPose(a, i / 20);
        for (const v of Object.values(p)) expect(Number.isFinite(v), `${a} @ ${i}`).toBe(true);
        expect(p.opacity).toBeGreaterThanOrEqual(0);
        expect(p.scale).toBeGreaterThan(0);
        expect(p.blur).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("bounce and pop overshoot past full size before settling", () => {
    const peak = (a: CaptionAnimation) => Math.max(...Array.from({ length: 50 }, (_, i) => enterPose(a, i / 50).scale));
    expect(peak("pop")).toBeGreaterThan(1);
    expect(peak("bounce")).toBeGreaterThan(1.1);
  });
});

describe("spoken-word motion", () => {
  it("holds grow and lift while the word is spoken, even on a still frame", () => {
    expect(motionPose("grow", Infinity).scale).toBeGreaterThan(1.1);
    expect(motionPose("lift", Infinity).dy).toBeLessThan(0);
    for (const m of MOTIONS) {
      for (const v of Object.values(motionPose(m, Infinity))) expect(Number.isFinite(v), m).toBe(true);
    }
  });

  it("eases back out after the next word takes over", () => {
    expect(motionPose("grow", 0.5, 0.05).scale).toBeGreaterThan(1);
    expect(motionPose("grow", 0.5, 0.05).scale).toBeLessThan(motionPose("grow", 0.5).scale);
    expect(motionPose("grow", 0.5, 1)).toBe(REST);
  });

  it("plays one-shot hops and shakes, then rests", () => {
    expect(motionPose("hop", 0.15).dy).toBeLessThan(0);
    expect(motionPose("hop", 1)).toBe(REST);
    expect(motionPose("shake", 0.03).rotate).not.toBe(0);
    expect(motionPose("shake", 1)).toBe(REST);
    expect(motionPose("none", 0.1)).toBe(REST);
  });
});

describe("loops", () => {
  it("glitches on landing and is deterministic", () => {
    expect(glitchAmount(0.05)).not.toBe(0);
    expect(glitchAmount(1.234)).toBe(glitchAmount(1.234));
    // Calm most of the time after landing.
    const calm = Array.from({ length: 200 }, (_, i) => glitchAmount(0.3 + i * 0.05)).filter((g) => g === 0).length;
    expect(calm).toBeGreaterThan(120);
  });

  it("floats gently and ripples letters out of phase", () => {
    expect(Math.abs(loopBlockPose("float", 0.5).dy)).toBeLessThan(0.1);
    expect(loopBlockPose("none", 0.5)).toBe(REST);
    expect(waveOffset(0.3, 0)).not.toBeCloseTo(waveOffset(0.3, 1));
    expect(waveOffset(Infinity, 3)).toBe(0);
  });

  it("sweeps the shine across, then pauses", () => {
    expect(shinePosition(0)).toBe(0);
    expect(shinePosition(0.45)).toBeCloseTo(0.5);
    expect(shinePosition(2)).toBeNull();
    expect(shinePosition(2.6)).toBe(0);
  });
});

describe("word timing", () => {
  it("uses the transcript's word times when the text still matches", () => {
    const c = cue([
      ["Hello", 0.2, 0.5],
      ["there", 0.6, 1.0],
    ]);
    expect(tokenTimings(c, ["Hello", "there"])).toEqual([
      { start: 0.2, end: 0.5 },
      { start: 0.6, end: 1.0 },
    ]);
  });

  it("spreads time by length when an edit broke the match", () => {
    const c = cue([["Hello", 0, 1]], 0, 2);
    const t = tokenTimings(c, ["Hi", "everyone"]);
    expect(t[0].start).toBe(0);
    expect(t[1].start).toBeCloseTo(0.4);
    expect(t[1].end).toBeCloseTo(2);
  });

  it("keeps start times in order and inside the caption", () => {
    const c = cue(
      [
        ["a", 0.5, 0.4],
        ["b", 0.3, 0.6],
        ["c", 9, 10],
      ],
      0.4,
      2,
    );
    const t = tokenTimings(c, ["a", "b", "c"]);
    expect(t[1].start).toBeGreaterThanOrEqual(t[0].start);
    expect(t[2].start).toBeLessThanOrEqual(2);
    for (const x of t) expect(x.end).toBeGreaterThanOrEqual(x.start);
  });

  it("finds the word being spoken", () => {
    const t = [
      { start: 0.2, end: 0.5 },
      { start: 0.6, end: 1 },
    ];
    expect(activeToken(t, 0.1)).toBe(-1);
    expect(activeToken(t, 0.55)).toBe(0);
    expect(activeToken(t, 0.6)).toBe(1);
  });

  it("staggers letters to fit the word, within bounds", () => {
    expect(letterStagger(0.3, 1)).toBe(0);
    expect(letterStagger(0.3, 6)).toBeCloseTo(0.05);
    expect(letterStagger(5, 4)).toBe(0.06);
    expect(letterStagger(0.05, 20)).toBe(0.015);
  });
});

describe("scripts and colour", () => {
  it("only splits letters in scripts that survive it", () => {
    expect(canSplitLetters("Hello,")).toBe(true);
    expect(canSplitLetters("café")).toBe(true);
    expect(canSplitLetters("నమస్కారం")).toBe(false);
    expect(canSplitLetters("नमस्ते")).toBe(false);
    expect(canSplitLetters("مرحبا")).toBe(false);
  });

  it("keeps accents with their letter", () => {
    expect(splitGraphemes("café")).toEqual(["c", "a", "f", "é"]);
  });

  it("detects right-to-left text", () => {
    expect(isRtl("مرحبا")).toBe(true);
    expect(isRtl("hello")).toBe(false);
  });

  it("picks readable text for a highlight box", () => {
    expect(contrastText("#facc15")).toBe("#111111");
    expect(contrastText("#7c3aed")).toBe("#ffffff");
    expect(contrastText("nonsense")).toBe("#ffffff");
  });
});

describe("keywords", () => {
  it("prefers numbers, then long content words, never stop words", () => {
    expect([...pickKeywords(["I", "made", "$5000", "today"])]).toEqual([2]);
    expect([...pickKeywords(["this", "changed", "everything"])]).toEqual([2]);
    expect(pickKeywords(["and", "the", "it"]).size).toBe(0);
  });

  it("picks two in longer captions and works on any script", () => {
    expect(pickKeywords(["we", "built", "something", "really", "incredible", "together"]).size).toBe(2);
    expect([...pickKeywords(["ఇది", "అద్భుతంగా", "ఉంది"])]).toEqual([1]);
  });
});

describe("speakers", () => {
  it("numbers speakers by first appearance", () => {
    const words = numberSpeakers([{ speaker: "B" }, { speaker: "A" }, {}, { speaker: "B" }]);
    expect(words.map((w) => w.speaker)).toEqual(["0", "1", undefined, "0"]);
  });

  it("reads each word's speaker, or the first word's after an edit", () => {
    const c = cue([
      ["hi", 0, 0.5],
      ["there", 0.5, 1],
    ]);
    c.words[0].speaker = "1";
    c.words[1].speaker = "0";
    expect(tokenSpeakers(c, 2)).toEqual([1, 0]);
    expect(tokenSpeakers(c, 3)).toEqual([1, 1, 1]);
    expect(tokenSpeakers(cue([["hi", 0, 1]]), 1)).toEqual([0]);
  });
});
