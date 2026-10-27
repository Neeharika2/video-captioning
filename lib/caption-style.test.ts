import { describe, expect, it } from "vitest";
import {
  ANIMATE_BY_LABELS,
  ANIMATION_LABELS,
  applyCase,
  blockTop,
  cssFont,
  DEFAULT_STYLE,
  FONT_GROUPS,
  FONT_LABELS,
  FONT_STACKS,
  FONT_FAMILIES,
  EMPHASIS_LABELS,
  fontSizeFor,
  LOOP_LABELS,
  normalizeStyle,
  sameStyle,
  speakerColor,
  styleForCaption,
  withAlpha,
  WORD_MOTION_LABELS,
} from "./caption-style";
import { PRESETS, PRESET_CATEGORIES } from "./caption-presets";

describe("caption styles", () => {
  it("ships twenty-three distinct, well-formed presets", () => {
    expect(PRESETS).toHaveLength(23);
    const ids = new Set(PRESETS.map((p) => p.id));
    expect(ids.size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.style.scale).toBeGreaterThan(0);
      expect(p.style.textColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.style.highlightColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.style.boxColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(["none", "upper", "lower"]).toContain(p.style.textCase);
      expect([1, 2, 3, 4]).toContain(p.style.wordsPerCaption);
      expect(PRESET_CATEGORIES.map((c) => c.id)).toContain(p.category);
      expect(typeof p.style.outline).toBe("boolean");
    }
  });

  it("uses only shipped fonts in its presets", () => {
    const shipped = new Set<string>(FONT_FAMILIES);
    for (const p of PRESETS) {
      expect(shipped.has(p.style.fontFamily), p.id).toBe(true);
      expect(shipped.has(p.style.keywordFontFamily), p.id).toBe(true);
    }
  });

  it("balances punchline, spoken and block looks", () => {
    const of = (category: string) => PRESETS.filter((p) => p.category === category).length;
    // The reference's punchline lockups are where the set should lean.
    expect(of("punchline")).toBeGreaterThanOrEqual(7);
    // The spoken presets are well liked and deliberately capped.
    expect(of("spoken")).toBeGreaterThanOrEqual(5);
    expect(of("spoken")).toBeLessThanOrEqual(7);
    expect(of("block")).toBe(5);
  });

  it("gives every preset its own signature", () => {
    const signature = (s: (typeof PRESETS)[number]["style"]) =>
      [s.fontFamily, s.keywordFontFamily, s.keywordWeight, s.textCase, s.treatment, s.emphasis, s.emphasisTarget, s.layout, s.wordsPerCaption].join("|");
    const seen = new Map<string, string>();
    for (const p of PRESETS) {
      const key = signature(p.style);
      expect(seen.has(key), `${p.id} is a near-copy of ${seen.get(key)}`).toBe(false);
      seen.set(key, p.id);
    }
  });

  it("fills every gallery section", () => {
    for (const c of PRESET_CATEGORIES) expect(PRESETS.some((p) => p.category === c.id), c.id).toBe(true);
  });

  it("covers the extended axes the presets rely on", () => {
    const styles = PRESETS.map((p) => p.style);
    expect(styles.some((s) => s.treatment === "glow")).toBe(true);
    expect(styles.some((s) => s.treatment === "box" && s.boxColor.toLowerCase() !== "#000000")).toBe(true);
    expect(styles.some((s) => s.textCase === "upper")).toBe(true);
    expect(styles.some((s) => s.textCase === "lower")).toBe(true);
    expect(styles.some((s) => s.wordsPerCaption === 1)).toBe(true);
    expect(styles.some((s) => s.emphasis === "weight")).toBe(true);
    expect(styles.some((s) => s.emphasis === "fill")).toBe(true);
    expect(styles.some((s) => s.treatment === "tiles")).toBe(true);
    expect(styles.some((s) => s.emphasisTarget === "keyword")).toBe(true);
    expect(styles.some((s) => s.layout === "lockup")).toBe(true);
    expect(styles.some((s) => s.layout === "stack")).toBe(true);
    expect(styles.some((s) => s.keywordGradient)).toBe(true);
    expect(styles.some((s) => s.gradient)).toBe(true);
    expect(styles.some((s) => s.bilingual)).toBe(true);
    expect(styles.some((s) => s.speakerColors)).toBe(true);
    expect(styles.some((s) => s.outline)).toBe(true);
    expect(styles.some((s) => s.align === "left")).toBe(true);
    expect(styles.some((s) => s.align === "right")).toBe(true);
    expect(styles.some((s) => s.fontFamily === "righteous")).toBe(true);
    expect(styles.some((s) => s.fontFamily === "dmSerifDisplay")).toBe(true);
  });

  it("turns a hex colour and opacity into an rgba string", () => {
    expect(withAlpha("#000000", 0.55)).toBe("rgba(0, 0, 0, 0.55)");
    expect(withAlpha("#fce7f3", 0.5)).toBe("rgba(252, 231, 243, 0.5)");
    expect(withAlpha("rgb(1,2,3)", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
    expect(withAlpha("#ffffff", 2)).toBe("rgba(255, 255, 255, 1)");
  });

  it("uses the Classic Reels preset as the default", () => {
    const classic = PRESETS.find((p) => p.id === "classic-reels");
    expect(classic).toBeDefined();
    expect(sameStyle(DEFAULT_STYLE, classic!.style)).toBe(true);
    expect(classic!.style.emphasisTarget).toBe("spoken");
    expect(classic!.style.layout).toBe("block");
  });

  it("scales the font from the frame's short side", () => {
    const style = { ...DEFAULT_STYLE, scale: 0.05 };
    // Same short side, so the same size in landscape and portrait.
    expect(fontSizeFor(style, 1920, 1080)).toBe(fontSizeFor(style, 1080, 1920));
    expect(fontSizeFor(style, 1080, 1920)).toBe(54);
  });

  it("never draws text smaller than 12px", () => {
    expect(fontSizeFor({ ...DEFAULT_STYLE, scale: 0.001 }, 100, 100)).toBe(12);
  });

  it("positions the caption block top, middle or bottom", () => {
    const args = [1000, 100] as const;
    expect(blockTop({ ...DEFAULT_STYLE, position: "top" }, ...args)).toBe(70);
    expect(blockTop({ ...DEFAULT_STYLE, position: "middle" }, ...args)).toBe(450);
    expect(blockTop({ ...DEFAULT_STYLE, position: "bottom" }, ...args)).toBe(830);
  });

  it("keeps multi-script fallbacks in every font stack", () => {
    for (const stack of Object.values(FONT_STACKS)) {
      // Latin display faces must never mask the scripts our transcriptions meet.
      expect(stack).toContain("Noto Sans Telugu");
      expect(stack).toContain("Noto Sans Devanagari");
      expect(stack).toContain("Noto Sans Arabic");
      expect(stack).toMatch(/(sans-serif|serif|monospace|cursive)$/);
    }
  });

  it("offers the self-hosted faces, each ending in a generic family", () => {
    const stacks = Object.values(FONT_STACKS);
    expect(stacks.length).toBe(FONT_FAMILIES.length);
    expect(FONT_FAMILIES.length).toBe(40);
    for (const stack of stacks) {
      expect(stack).toMatch(/(sans-serif|serif|monospace|cursive)$/);
    }
  });

  it("keeps a set of clean, regular faces for everyday captions", () => {
    const clean = FONT_GROUPS.find((g) => g.label === "Clean & regular");
    expect(clean?.fonts).toEqual(["inter", "poppins", "montserrat", "oswald"]);
  });

  it("lists every font exactly once in the picker groups, with a label", () => {
    const grouped = FONT_GROUPS.flatMap((g) => g.fonts);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(FONT_FAMILIES));
    for (const family of grouped) {
      expect(FONT_LABELS[family]).toBeTruthy();
      expect(FONT_STACKS[family].length).toBeGreaterThan(0);
    }
  });

  it("builds the canvas font string from weight, size and family", () => {
    expect(cssFont({ ...DEFAULT_STYLE, weight: 800 }, 42)).toMatch(/^800 42px /);
  });
});

describe("caption effects in styles", () => {
  it("gives every preset valid effects and no free-placement offset", () => {
    for (const p of PRESETS) {
      expect(p.style.offsetX).toBe(0);
      expect(p.style.offsetY).toBe(0);
      expect(Object.keys(ANIMATION_LABELS)).toContain(p.style.animation);
      expect(Object.keys(ANIMATE_BY_LABELS)).toContain(p.style.animateBy);
      expect(Object.keys(EMPHASIS_LABELS)).toContain(p.style.emphasis);
      expect(Object.keys(WORD_MOTION_LABELS)).toContain(p.style.wordMotion);
      expect(Object.keys(LOOP_LABELS)).toContain(p.style.loop);
      expect(typeof p.style.dimUpcoming).toBe("boolean");
    }
  });

  it("showcases every spoken-word style and loop across the presets", () => {
    const styles = PRESETS.map((p) => p.style);
    for (const emphasis of ["color", "sweep", "box", "marker", "underline"] as const) {
      expect(styles.some((s) => s.emphasis === emphasis)).toBe(true);
    }
    for (const loop of ["float", "wave", "shine", "glitch"] as const) {
      expect(styles.some((s) => s.loop === loop)).toBe(true);
    }
    expect(styles.some((s) => s.animateBy === "word")).toBe(true);
    expect(styles.some((s) => s.animateBy === "letter")).toBe(true);
  });

  it("upgrades older saved styles and fills new settings with defaults", () => {
    const old = { ...DEFAULT_STYLE, emphasis: "highlight", treatment: "outline" } as Record<string, unknown>;
    delete old.animateBy;
    delete old.loop;
    const style = normalizeStyle(old);
    expect(style.emphasis).toBe("color");
    expect(style.treatment).toBe("plain");
    expect(style.outline).toBe(true);
    expect(style.animateBy).toBe(DEFAULT_STYLE.animateBy);
    expect(style.loop).toBe(DEFAULT_STYLE.loop);
  });

  it("upgrades the old `keywords` flag to an emphasis target", () => {
    const { emphasisTarget: _t, ...rest } = DEFAULT_STYLE;
    void _t;
    expect(normalizeStyle({ ...rest, keywords: true }).emphasisTarget).toBe("keyword");
    expect(normalizeStyle({ ...rest, keywords: false }).emphasisTarget).toBe("spoken");
    expect(normalizeStyle({ ...DEFAULT_STYLE, emphasisTarget: "keyword" }).emphasisTarget).toBe("keyword");
    expect(normalizeStyle({ ...DEFAULT_STYLE, layout: "lockup" }).layout).toBe("lockup");
    expect(normalizeStyle({ ...DEFAULT_STYLE, layout: "nope" }).layout).toBe(DEFAULT_STYLE.layout);
  });

  it("upgrades the old uppercase flag and keeps words per caption in range", () => {
    const { textCase: _c, ...rest } = DEFAULT_STYLE;
    void _c;
    expect(normalizeStyle({ ...rest, uppercase: true }).textCase).toBe("upper");
    expect(normalizeStyle({ ...rest, uppercase: false }).textCase).toBe("none");
    expect(normalizeStyle({ ...DEFAULT_STYLE, textCase: "lower" }).textCase).toBe("lower");
    expect(normalizeStyle({ ...DEFAULT_STYLE, wordsPerCaption: 9 }).wordsPerCaption).toBe(DEFAULT_STYLE.wordsPerCaption);
    expect(normalizeStyle({ ...DEFAULT_STYLE, wordsPerCaption: 2 }).wordsPerCaption).toBe(2);
    expect(normalizeStyle({ ...DEFAULT_STYLE, treatment: "tiles" }).treatment).toBe("tiles");
  });

  it("applies the text case", () => {
    expect(applyCase({ textCase: "upper" }, "Make it")).toBe("MAKE IT");
    expect(applyCase({ textCase: "lower" }, "Make it")).toBe("make it");
    expect(applyCase({ textCase: "none" }, "Make it")).toBe("Make it");
  });

  it("colours speakers text colour first, then the accent, then a palette", () => {
    const style = { ...DEFAULT_STYLE, textColor: "#ffffff", highlightColor: "#00ffff" };
    expect(speakerColor(style, 0)).toBe("#ffffff");
    expect(speakerColor(style, 1)).toBe("#00ffff");
    expect(speakerColor(style, 2)).not.toBe(speakerColor(style, 1));
  });

  it("drops invalid stored values instead of trusting them", () => {
    const style = normalizeStyle({ animation: "explode", textColor: "red", scale: 99, fontFamily: "Comic Sans" });
    expect(style.animation).toBe(DEFAULT_STYLE.animation);
    expect(style.textColor).toBe(DEFAULT_STYLE.textColor);
    expect(style.fontFamily).toBe(DEFAULT_STYLE.fontFamily);
    expect(style.scale).toBeLessThanOrEqual(0.12);
    expect(normalizeStyle(null)).toEqual(DEFAULT_STYLE);
    expect(sameStyle(normalizeStyle(PRESETS[5].style), PRESETS[5].style)).toBe(true);
  });

  it("counts free placement and animation as part of the style identity", () => {
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE })).toBe(true);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, offsetY: -0.2 })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, animation: "pop" })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, boxColor: "#ffffff" })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, textCase: "upper" })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, wordsPerCaption: 2 })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, outline: true })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, loop: "wave" })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, dimUpcoming: true })).toBe(false);
  });

  it("lets one caption carry its own placement and size over the style default", () => {
    const placed = styleForCaption(DEFAULT_STYLE, { position: "top", offsetX: 0.1, offsetY: -0.2 }, 0.07);
    expect(placed.position).toBe("top");
    expect(placed.offsetX).toBe(0.1);
    expect(placed.offsetY).toBe(-0.2);
    expect(placed.scale).toBe(0.07);
    // Only the placement and size change; the rest of the look is untouched.
    expect(placed.fontFamily).toBe(DEFAULT_STYLE.fontFamily);
    expect(placed.treatment).toBe(DEFAULT_STYLE.treatment);

    // A size override works without a placement, too.
    const sized = styleForCaption(DEFAULT_STYLE, undefined, 0.06);
    expect(sized.scale).toBe(0.06);
    expect(sized.position).toBe(DEFAULT_STYLE.position);

    // Nothing to override → the style is used as-is.
    expect(styleForCaption(DEFAULT_STYLE)).toBe(DEFAULT_STYLE);
  });
});
