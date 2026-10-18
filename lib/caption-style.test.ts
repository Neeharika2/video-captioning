import { describe, expect, it } from "vitest";
import {
  blockTop,
  cssFont,
  DEFAULT_STYLE,
  FONT_STACKS,
  fontSizeFor,
  PRESETS,
  sameStyle,
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
