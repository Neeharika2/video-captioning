import { describe, expect, it } from "vitest";
import {
  ANIMATION_SECONDS,
  blockTop,
  captionEnter,
  cssFont,
  DEFAULT_STYLE,
  FONT_GROUPS,
  FONT_LABELS,
  FONT_STACKS,
  FONT_FAMILIES,
  fontSizeFor,
  PRESETS,
  sameStyle,
  styleForCaption,
  withAlpha,
} from "./caption-style";

describe("caption styles", () => {
  it("ships ten distinct, well-formed presets", () => {
    expect(PRESETS).toHaveLength(10);
    const ids = new Set(PRESETS.map((p) => p.id));
    expect(ids.size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.style.scale).toBeGreaterThan(0);
      expect(p.style.textColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.style.highlightColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.style.boxColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof p.style.uppercase).toBe("boolean");
      expect(typeof p.style.outline).toBe("boolean");
    }
  });

  it("gives every preset its own font", () => {
    const fonts = PRESETS.map((p) => p.style.fontFamily);
    expect(new Set(fonts).size).toBe(PRESETS.length);
  });

  it("covers the extended axes the presets rely on", () => {
    const styles = PRESETS.map((p) => p.style);
    expect(styles.some((s) => s.treatment === "glow")).toBe(true);
    expect(styles.some((s) => s.treatment === "box" && s.boxColor.toLowerCase() !== "#000000")).toBe(true);
    expect(styles.some((s) => s.uppercase)).toBe(true);
    expect(styles.some((s) => s.outline)).toBe(true);
    expect(styles.some((s) => s.fontFamily === "righteous")).toBe(true);
    expect(styles.some((s) => s.fontFamily === "dmSerifDisplay")).toBe(true);
  });

  it("turns a hex colour and opacity into an rgba string", () => {
    expect(withAlpha("#000000", 0.55)).toBe("rgba(0, 0, 0, 0.55)");
    expect(withAlpha("#fce7f3", 0.5)).toBe("rgba(252, 231, 243, 0.5)");
    expect(withAlpha("rgb(1,2,3)", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
    expect(withAlpha("#ffffff", 2)).toBe("rgba(255, 255, 255, 1)");
  });

  it("uses the first preset as the default", () => {
    expect(sameStyle(DEFAULT_STYLE, PRESETS[0].style)).toBe(true);
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
      expect(stack).toMatch(/(sans-serif|serif|monospace)$/);
    }
  });

  it("offers the self-hosted faces, each ending in a generic family", () => {
    const stacks = Object.values(FONT_STACKS);
    expect(stacks.length).toBe(FONT_FAMILIES.length);
    expect(FONT_FAMILIES.length).toBe(13);
    for (const stack of stacks) {
      expect(stack).toMatch(/(sans-serif|serif|monospace)$/);
    }
  });

  it("keeps three clean, regular faces for everyday captions", () => {
    const clean = FONT_GROUPS.find((g) => g.label === "Clean & regular");
    expect(clean?.fonts).toEqual(["inter", "poppins", "montserrat"]);
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

describe("caption appearance animation", () => {
  it("rests once it is done, or when there is no animation", () => {
    expect(captionEnter("none", 0)).toEqual({ opacity: 1, scale: 1, shiftY: 0 });
    expect(captionEnter("fade", ANIMATION_SECONDS)).toEqual({ opacity: 1, scale: 1, shiftY: 0 });
    expect(captionEnter("pop", Infinity)).toEqual({ opacity: 1, scale: 1, shiftY: 0 });
  });

  it("fades in from transparent to opaque", () => {
    expect(captionEnter("fade", 0).opacity).toBe(0);
    expect(captionEnter("fade", ANIMATION_SECONDS / 2).opacity).toBeGreaterThan(0.4);
    expect(captionEnter("fade", ANIMATION_SECONDS * 2).opacity).toBe(1);
  });

  it("pops up from smaller than full size and overshoots once", () => {
    expect(captionEnter("pop", 0).scale).toBeLessThan(1);
    expect(captionEnter("pop", ANIMATION_SECONDS / 2).scale).toBeGreaterThan(1);
  });

  it("rises up into place from below", () => {
    expect(captionEnter("rise", 0).shiftY).toBeGreaterThan(0);
    expect(captionEnter("rise", ANIMATION_SECONDS).shiftY).toBe(0);
  });

  it("gives every preset an animation and no free-placement offset", () => {
    for (const p of PRESETS) {
      expect(p.style.offsetX).toBe(0);
      expect(p.style.offsetY).toBe(0);
      expect(["none", "fade", "pop", "rise"]).toContain(p.style.animation);
    }
  });

  it("counts free placement and animation as part of the style identity", () => {
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE })).toBe(true);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, offsetY: -0.2 })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, animation: "pop" })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, boxColor: "#ffffff" })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, uppercase: true })).toBe(false);
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE, outline: true })).toBe(false);
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
