import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, type CaptionStyle } from "../caption-style";
import type { Caption } from "../types";
import { drawCaption, findCaptionAt } from "./caption-renderer";

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type Call = {
  op: string;
  text?: string;
  x?: number;
  y?: number;
  fill: unknown;
  stroke: unknown;
  font: string;
  alpha: number;
  m: Matrix;
  clipped: boolean;
  shadow: { x: number; y: number; blur: number };
};

/**
 * Records what a 2D canvas would draw. Text is measured as 0.5em per
 * character, which is all the layout needs.
 */
function fakeCtx() {
  const calls: Call[] = [];
  let state = {
    m: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as Matrix,
    globalAlpha: 1,
    fillStyle: "#000000" as unknown,
    strokeStyle: "#000000" as unknown,
    font: "10px sans-serif",
    filter: "none",
    clipped: false,
    shadowBlur: 0,
    shadowColor: "",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineJoin: "miter",
    textAlign: "start",
    textBaseline: "alphabetic",
  };
  const stack: (typeof state)[] = [];
  const record = (op: string, text?: string, x?: number, y?: number) =>
    calls.push({
      op,
      text,
      x,
      y,
      fill: state.fillStyle,
      stroke: state.strokeStyle,
      font: state.font,
      alpha: state.globalAlpha,
      m: { ...state.m },
      clipped: state.clipped,
      shadow: { x: state.shadowOffsetX, y: state.shadowOffsetY, blur: state.shadowBlur },
    });

  const ctx = {
    calls,
    save: () => stack.push({ ...state, m: { ...state.m } }),
    restore: () => {
      state = stack.pop() ?? state;
    },
    translate: (x: number, y: number) => {
      const m = state.m;
      m.e += m.a * x + m.c * y;
      m.f += m.b * x + m.d * y;
    },
    scale: (sx: number, sy: number) => {
      const m = state.m;
      m.a *= sx;
      m.b *= sx;
      m.c *= sy;
      m.d *= sy;
    },
    rotate: (r: number) => {
      const { a, b, c, d } = state.m;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      Object.assign(state.m, { a: a * cos + c * sin, b: b * cos + d * sin, c: c * cos - a * sin, d: d * cos - b * sin });
    },
    getTransform: () => ({ ...state.m }),
    setTransform: (m: Matrix) => {
      state.m = { ...m };
    },
    measureText: (text: string) => ({ width: text.length * Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10) * 0.5 }),
    fillText: (text: string, x: number, y: number) => record("fillText", text, x, y),
    strokeText: (text: string, x: number, y: number) => record("strokeText", text, x, y),
    fill: () => record("fill"),
    clip: () => {
      state.clipped = true;
    },
    beginPath: () => {},
    closePath: () => {},
    rect: () => {},
    roundRect: () => {},
    moveTo: () => {},
    arcTo: () => {},
    createLinearGradient: () => ({ gradient: true, addColorStop: () => {} }),
  };
  for (const key of Object.keys(state) as (keyof typeof state)[]) {
    if (key === "m") continue;
    Object.defineProperty(ctx, key, {
      get: () => state[key],
      set: (v) => {
        (state as Record<string, unknown>)[key] = v;
      },
      enumerable: true,
    });
  }
  return ctx;
}

const caption: Caption = {
  id: "c1",
  text: "Make it pop",
  start: 1,
  end: 3,
  words: [
    { text: "Make", start: 1.1, end: 1.4 },
    { text: "it", start: 1.5, end: 1.7 },
    { text: "pop", start: 1.8, end: 2.6 },
  ],
};

const style = (part: Partial<CaptionStyle>): CaptionStyle => ({ ...DEFAULT_STYLE, treatment: "plain", ...part });

function draw(part: Partial<CaptionStyle>, t: number, still = false, c: Caption = caption) {
  const ctx = fakeCtx();
  drawCaption(ctx as unknown as CanvasRenderingContext2D, c, 1080, 1920, style(part), t, { still });
  const fills = ctx.calls.filter((x) => x.op === "fillText" && !x.clipped);
  return { calls: ctx.calls, fills, texts: fills.map((f) => f.text) };
}

describe("drawCaption", () => {
  it("draws every word of a caption", () => {
    expect(draw({}, 2, true).texts).toEqual(["Make", "it", "pop"]);
  });

  it("is a pure function of time, so preview and export match", () => {
    const opts = { emphasis: "box", wordMotion: "shake", loop: "glitch", animateBy: "letter", animation: "bounce" } as const;
    expect(draw(opts, 1.83).calls).toEqual(draw(opts, 1.83).calls);
  });

  it("reveals words as they're spoken in word mode, all of them when still", () => {
    expect(draw({ animateBy: "word", animation: "pop" }, 1.6).texts).toEqual(["Make", "it"]);
    expect(draw({ animateBy: "word", animation: "pop" }, 1.6, true).texts).toEqual(["Make", "it", "pop"]);
  });

  it("colours the spoken word", () => {
    const { fills } = draw({ emphasis: "color", highlightColor: "#ff0000", textColor: "#ffffff" }, 1.55);
    expect(fills.map((f) => f.fill)).toEqual(["#ffffff", "#ff0000", "#ffffff"]);
  });

  it("sweeps the karaoke colour across the spoken word", () => {
    const { calls } = draw({ emphasis: "sweep", highlightColor: "#ff0000" }, 2.0);
    const fills = calls.filter((c) => c.op === "fillText");
    // Earlier words are filled; "pop" gets a clipped overlay part-way through.
    expect(fills.find((f) => f.text === "Make")?.fill).toBe("#ff0000");
    expect(fills.some((f) => f.text === "pop" && f.clipped && f.fill === "#ff0000")).toBe(true);
  });

  it("draws a glide box behind the spoken word with readable text on it", () => {
    const { calls, fills } = draw({ emphasis: "box", highlightColor: "#facc15", textColor: "#ffffff" }, 1.55, true);
    const box = calls.findIndex((c) => c.op === "fill" && c.fill === "#facc15");
    const firstText = calls.findIndex((c) => c.op === "fillText");
    expect(box).toBeGreaterThanOrEqual(0);
    expect(box).toBeLessThan(firstText);
    expect(fills.find((f) => f.text === "it")?.fill).toBe("#111111");
  });

  it("dims words that haven't been spoken yet", () => {
    const { fills } = draw({ dimUpcoming: true }, 1.55, true);
    expect(fills[1].alpha).toBe(1);
    expect(fills[2].alpha).toBeLessThan(0.5);
  });

  it("splits Latin words into letters but keeps Telugu words whole", () => {
    const mixed: Caption = { ...caption, text: "Hi నమస్కారం", words: [] };
    const { texts } = draw({ animateBy: "letter" }, 2.5, true, mixed);
    expect(texts).toEqual(["H", "i", "నమస్కారం"]);
  });

  it("outlines every glyph before filling any, so outlines never cut into neighbours", () => {
    const { calls } = draw({ outline: true, animateBy: "letter" }, 2.5, true);
    const lastStroke = calls.map((c) => c.op).lastIndexOf("strokeText");
    const firstFill = calls.findIndex((c) => c.op === "fillText");
    expect(lastStroke).toBeGreaterThanOrEqual(0);
    expect(lastStroke).toBeLessThan(firstFill);
  });

  it("starts an entrance away from rest and lands on it", () => {
    const early = draw({ animation: "zoom" }, 1.02).fills[0];
    const late = draw({ animation: "zoom" }, 2).fills[0];
    expect(early.m.a).toBeGreaterThan(1);
    expect(late.m.a).toBe(1);
    expect(early.alpha).toBeLessThan(1);
  });
});

describe("drawCaption: preset looks", () => {
  const strokes = (calls: Call[]) => calls.filter((c) => c.op === "strokeText");

  it("bolds only the spoken word in weight shift", () => {
    const { fills } = draw({ emphasis: "weight", weight: 300 }, 1.55);
    expect(fills.map((f) => f.font.split(" ")[0])).toEqual(["300", "800", "300"]);
  });

  it("keeps unspoken words hollow and fills the spoken one", () => {
    const { calls, texts } = draw({ emphasis: "fill" }, 1.55, true);
    expect(texts).toEqual(["Make", "it"]);
    expect(strokes(calls).map((c) => c.text)).toEqual(["pop"]);
    // Mid-word, the spoken word floods in through a clipped fill.
    const mid = draw({ emphasis: "fill" }, 2.0).calls;
    expect(mid.some((c) => c.op === "fillText" && c.text === "pop" && c.clipped)).toBe(true);
  });

  it("puts every word on its own tile", () => {
    const { calls } = draw({ treatment: "tiles", boxColor: "#ffffff", boxOpacity: 1 }, 2, true);
    const tiles = calls.filter((c) => c.op === "fill" && c.fill === "rgba(255, 255, 255, 1)");
    expect(tiles).toHaveLength(3);
  });

  it("casts a hard, unblurred offset shadow for comic lettering", () => {
    const { calls } = draw({ treatment: "comic" }, 2, true);
    const shadowed = calls.filter((c) => c.shadow.x > 0 && c.shadow.y > 0);
    expect(shadowed.length).toBeGreaterThan(0);
    expect(shadowed.every((c) => c.shadow.blur === 0)).toBe(true);
  });

  it("sets punchline words bigger in the accent colour", () => {
    const c: Caption = { ...caption, text: "I made $5000", words: [] };
    const { fills } = draw({ emphasisTarget: "keyword", highlightColor: "#00ff00" }, 2, true, c);
    const size = (f: Call) => Number(/(\d+)px/.exec(f.font)?.[1]);
    expect(fills[2].fill).toBe("#00ff00");
    expect(size(fills[2])).toBeGreaterThan(size(fills[0]));
  });

  it("fills text with a gradient", () => {
    const { fills } = draw({ gradient: true }, 2, true);
    expect(fills.every((f) => (f.fill as { gradient?: boolean }).gradient)).toBe(true);
  });

  it("breaks a lockup into a base line and a bigger punchline line in a second font", () => {
    const c: Caption = { ...caption, text: "we made 5000", words: [] };
    const { fills } = draw(
      { layout: "lockup", emphasisTarget: "keyword", keywordFontFamily: "anton", keywordScale: 2 },
      2,
      true,
      c,
    );
    const size = (f: Call) => Number(/(\d+)px/.exec(f.font)?.[1]);
    const base = fills.filter((f) => f.text === "we" || f.text === "made");
    const hero = fills.find((f) => f.text === "5000");
    expect(base).toHaveLength(2);
    expect(hero).toBeDefined();
    // Base words share a line; the punchline sits on the line below, bigger.
    expect(base[0].y).toBe(base[1].y);
    expect(hero!.y!).toBeGreaterThan(base[0].y!);
    expect(size(hero!)).toBeGreaterThan(size(base[0]));
    expect(hero!.font).toContain("Anton");
  });

  it("keeps a middle punchline in reading order instead of forcing it to the bottom", () => {
    const c: Caption = { ...caption, text: "we made 5000 today", words: [], punchlineWordIndices: [2] };
    const { fills } = draw({ layout: "lockup", emphasisTarget: "keyword" }, 2, true, c);
    const y = (text: string) => fills.find((f) => f.text === text)!.y!;
    // The words before the punchline share a row; the punchline and the word
    // that follows keep their order, one row each.
    expect(y("we")).toBe(y("made"));
    expect(y("5000")).toBeGreaterThan(y("we"));
    expect(y("today")).toBeGreaterThan(y("5000"));
  });

  it("stacks one word per row in a stack layout", () => {
    const c: Caption = { ...caption, text: "we made 5000", words: [] };
    const { fills } = draw({ layout: "stack", emphasisTarget: "keyword" }, 2, true, c);
    expect(new Set(fills.map((f) => f.y)).size).toBe(3);
  });

  it("anchors the block to the left, centre or right edge", () => {
    const c: Caption = { ...caption, text: "pop", words: [] };
    const x = (align: CaptionStyle["align"]) => draw({ align }, 2, true, c).fills[0].x!;
    expect(x("left")).toBeLessThan(x("center"));
    expect(x("center")).toBeLessThan(x("right"));
  });

  it("fills the punchline with the text → accent gradient when asked", () => {
    const c: Caption = { ...caption, text: "we made 5000", words: [] };
    const { fills } = draw(
      { layout: "lockup", emphasisTarget: "keyword", keywordGradient: true, textColor: "#ff8a00", highlightColor: "#ffd000" },
      2,
      true,
      c,
    );
    expect((fills.find((f) => f.text === "5000")!.fill as { gradient?: boolean }).gradient).toBe(true);
  });

  it("ignores spoken-word emphasis when the accent targets the punchline", () => {
    const c: Caption = { ...caption, text: "we made 5000", words: [] };
    const { fills } = draw(
      { layout: "lockup", emphasisTarget: "keyword", emphasis: "color", highlightColor: "#00ff00" },
      2,
      true,
      c,
    );
    // "made" is the word being spoken, but the preset marks the punchline only.
    expect(fills.find((f) => f.text === "made")?.fill).not.toBe("#00ff00");
    expect(fills.find((f) => f.text === "5000")?.fill).toBe("#00ff00");
  });

  it("draws the other script under the caption", () => {
    const c: Caption = { ...caption, words: caption.words.map((w, i) => ({ ...w, alt: ["మేక్", "ఇట్", "పాప్"][i] })) };
    const { texts, fills } = draw({ bilingual: true }, 2, true, c);
    expect(texts).toEqual(["Make", "it", "pop", "మేక్ ఇట్ పాప్"]);
    expect(fills[3].y!).toBeGreaterThan(fills[0].y!);
  });

  it("colours each speaker", () => {
    const c: Caption = { ...caption, words: caption.words.map((w, i) => ({ ...w, speaker: i === 2 ? "1" : "0" })) };
    const { fills } = draw({ speakerColors: true, textColor: "#ffffff", highlightColor: "#00ffff" }, 2, true, c);
    expect(fills.map((f) => f.fill)).toEqual(["#ffffff", "#ffffff", "#00ffff"]);
  });
});

describe("findCaptionAt", () => {
  it("finds the cue on screen", () => {
    const cues = [caption, { ...caption, id: "c2", start: 3, end: 4 }];
    expect(findCaptionAt(cues, 0.5)).toBe(-1);
    expect(findCaptionAt(cues, 1.5)).toBe(0);
    expect(findCaptionAt(cues, 3.5)).toBe(1);
    expect(findCaptionAt(cues, 5)).toBe(-1);
  });
});
