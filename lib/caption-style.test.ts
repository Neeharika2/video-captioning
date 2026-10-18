import { describe, expect, it } from "vitest";
import {
  ANIMATION_SECONDS,
  blockTop,
  captionEnter,
  cssFont,
  DEFAULT_STYLE,
  FONT_STACKS,
  fontSizeFor,
  PRESETS,
  sameStyle,
  styleForCaption,
} from "./caption-style";

describe("caption styles", () => {
  it("ships three distinct, well-formed presets", () => {
    const ids = new Set(PRESETS.map((p) => p.id));
    expect(ids.size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.style.scale).toBeGreaterThan(0);
      expect(p.style.textColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.style.highlightColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
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

  it("keeps a Telugu fallback in every font stack", () => {
    for (const stack of Object.values(FONT_STACKS)) expect(stack).toContain("Telugu");
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
  });

  it("lets one caption carry its own placement over the style default", () => {
    const placed = styleForCaption(DEFAULT_STYLE, { position: "top", offsetX: 0.1, offsetY: -0.2 });
    expect(placed.position).toBe("top");
    expect(placed.offsetX).toBe(0.1);
    expect(placed.offsetY).toBe(-0.2);
    // Only the placement changes; the rest of the look is untouched.
    expect(placed.fontFamily).toBe(DEFAULT_STYLE.fontFamily);
    expect(placed.treatment).toBe(DEFAULT_STYLE.treatment);
    // No placement → the style is used as-is.
    expect(styleForCaption(DEFAULT_STYLE)).toBe(DEFAULT_STYLE);
  });
});
