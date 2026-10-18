import { describe, expect, it } from "vitest";
import { groupWords, isFiller, wrapLines } from "./group-words";
import type { Word } from "./types";

/** Words spaced 0.3 s apart, 0.25 s long, starting at `t0`. */
function speak(text: string, t0 = 0, speaker?: string): Word[] {
  return text.split(" ").map((w, i) => ({
    text: w,
    start: +(t0 + i * 0.3).toFixed(3),
    end: +(t0 + i * 0.3 + 0.25).toFixed(3),
    ...(speaker ? { speaker } : {}),
  }));
}

describe("groupWords", () => {
  it("times a cue from its first and last word", () => {
    const [c] = groupWords(speak("Hello there my friend", 2));
    expect(c.start).toBe(2);
    expect(c.text).toBe("Hello there my friend");
    expect(c.words).toHaveLength(4);
    expect(c.end).toBeCloseTo(2 + 0.9 + 0.25);
  });

  it("breaks at sentence ends", () => {
    const cues = groupWords(speak("I went home. Then I slept."));
    expect(cues.map((c) => c.text)).toEqual(["I went home.", "Then I slept."]);
  });

  it("breaks on long pauses", () => {
    const words = [...speak("first part", 0), ...speak("second part", 3)];
    expect(groupWords(words).map((c) => c.text)).toEqual(["first part", "second part"]);
  });

  it("breaks on speaker change", () => {
    const words = [...speak("hi there", 0, "spk_1"), ...speak("hello back", 0.6, "spk_2")];
    expect(groupWords(words).map((c) => c.text)).toEqual(["hi there", "hello back"]);
  });

  it("keeps cues within two lines of 42 characters", () => {
    const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const cues = groupWords(speak(text), { maxDuration: 100 });
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) {
      expect(c.text.length).toBeLessThanOrEqual(84);
      expect(c.lines!.length).toBeLessThanOrEqual(2);
      for (const l of c.lines!) expect(l.length).toBeLessThanOrEqual(42);
    }
  });

  it("splits cues longer than the max duration", () => {
    const cues = groupWords(speak("a b c d e f g h i j k l m n o p q r s t u v w x y z"));
    for (const c of cues) expect(c.words.at(-1)!.end - c.start).toBeLessThanOrEqual(6);
  });

  it("holds short cues for the minimum duration without overlapping the next", () => {
    const words: Word[] = [
      { text: "Yes.", start: 0, end: 0.2 },
      { text: "No.", start: 0.6, end: 0.8 },
      { text: "Maybe.", start: 5, end: 5.3 },
    ];
    const cues = groupWords(words);
    expect(cues[0].end).toBeCloseTo(0.56); // limited by the next cue (0.6 − 0.04)
    expect(cues[1].end).toBeCloseTo(1.6); // held to 1 s
    expect(cues[2].end).toBeCloseTo(6);
    for (let i = 1; i < cues.length; i++) expect(cues[i - 1].end).toBeLessThan(cues[i].start);
  });

  it("removes unambiguous fillers but keeps 'like'", () => {
    const cues = groupWords(speak("um I like uh this"));
    expect(cues[0].text).toBe("I like this");
    expect(groupWords(speak("um I like uh this"), { removeFillers: false })[0].text).toBe("um I like uh this");
  });

  it("keeps the sentence break carried by a removed filler", () => {
    const cues = groupWords(speak("that is all um. next one"));
    expect(cues.map((c) => c.text)).toEqual(["that is all", "next one"]);
  });

  it("handles Telugu text and empty input", () => {
    expect(groupWords([])).toEqual([]);
    const cues = groupWords(speak("నమస్కారం అందరికీ. ఈరోజు office కి వెళ్తాను."));
    expect(cues.map((c) => c.text)).toEqual(["నమస్కారం అందరికీ.", "ఈరోజు office కి వెళ్తాను."]);
  });
});

describe("wrapLines", () => {
  it("keeps short text on one line", () => {
    expect(wrapLines("short text", 42)).toEqual(["short text"]);
  });

  it("balances two lines", () => {
    expect(wrapLines("the quick brown fox jumps over the lazy dog again and again", 42)).toEqual([
      "the quick brown fox jumps over",
      "the lazy dog again and again",
    ]);
  });
});

describe("isFiller", () => {
  it("ignores case and punctuation", () => {
    expect(isFiller("Um,")).toBe(true);
    expect(isFiller("hmm...")).toBe(true);
    expect(isFiller("umbrella")).toBe(false);
  });
});
