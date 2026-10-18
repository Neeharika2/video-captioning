/**
 * Caption look-and-feel, kept separate from the transcript so a style can be
 * changed without re-transcribing (PLAN.md). Both the browser preview and the
 * burned-in export render from a `CaptionStyle`, so the two stay in sync.
 */

export type FontFamily = "sans" | "serif" | "mono";
export type CaptionTreatment = "plain" | "shadow" | "outline" | "box";
export type CaptionPosition = "top" | "middle" | "bottom";
export type CaptionEmphasis = "none" | "highlight";
/** How a caption comes on screen when its cue starts. */
export type CaptionAnimation = "none" | "fade" | "pop" | "rise";

export type CaptionStyle = {
  fontFamily: FontFamily;
  /** 400, 600 or 800. */
  weight: number;
  /** Font size as a fraction of the frame's short side (width for landscape). */
  scale: number;
  textColor: string;
  /** Colour of the word being spoken when `emphasis` is "highlight". */
  highlightColor: string;
  treatment: CaptionTreatment;
  /** Background opacity (0–1) when `treatment` is "box". */
  boxOpacity: number;
  /** Anchor the block sits at; free dragging adds `offsetX`/`offsetY` on top. */
  position: CaptionPosition;
  /** Free placement offset from the anchor, as a fraction of the frame size. */
  offsetX: number;
  offsetY: number;
  emphasis: CaptionEmphasis;
  /** Appearance animation, played when the cue first shows. */
  animation: CaptionAnimation;
};

/** Max share of the frame width a caption block may occupy. */
export const CAPTION_MAX_WIDTH = 0.88;

const TELUGU_SANS = '"Noto Sans Telugu", "Nirmala UI", "Gautami"';
const TELUGU_SERIF = '"Noto Serif Telugu", "Noto Sans Telugu", "Nirmala UI"';

/**
 * Font stacks, not single families: every Latin face is followed by a Telugu
 * fallback so code-switched captions shape correctly in both preview and export.
 */
export const FONT_STACKS: Record<FontFamily, string> = {
  sans: `system-ui, -apple-system, "Segoe UI", Roboto, Arial, ${TELUGU_SANS}, sans-serif`,
  serif: `Georgia, "Times New Roman", ${TELUGU_SERIF}, serif`,
  mono: `ui-monospace, "SFMono-Regular", Menlo, Consolas, ${TELUGU_SANS}, monospace`,
};

export const FONT_LABELS: Record<FontFamily, string> = {
  sans: "Sans — clean and readable",
  serif: "Serif — cinematic",
  mono: "Mono — technical",
};

export const WEIGHT_LABELS: Record<number, string> = {
  400: "Regular",
  600: "Semibold",
  800: "Bold",
};

export function fontStack(family: FontFamily): string {
  return FONT_STACKS[family];
}

/** CSS font shorthand used for both measuring and drawing on a canvas. */
export function cssFont(style: CaptionStyle, sizePx: number): string {
  return `${style.weight} ${sizePx}px ${FONT_STACKS[style.fontFamily]}`;
}

/** Font size in pixels for a frame of `width`×`height`, from the short side. */
export function fontSizeFor(style: CaptionStyle, width: number, height: number): number {
  return Math.max(12, Math.round(Math.min(width, height) * style.scale));
}

/** Where the caption block's top edge sits, given the block height. */
export function blockTop(style: CaptionStyle, height: number, blockHeight: number): number {
  const margin = Math.round(height * 0.07);
  if (style.position === "top") return margin;
  if (style.position === "middle") return (height - blockHeight) / 2;
  return height - margin - blockHeight;
}

export const ANIMATION_LABELS: Record<CaptionAnimation, string> = {
  none: "None",
  fade: "Fade",
  pop: "Pop",
  rise: "Rise",
};

/** How long an appearance animation runs (seconds). */
export const ANIMATION_SECONDS = 0.28;

export type CaptionEnter = {
  /** 0–1; multiplied into the block's opacity. */
  opacity: number;
  /** Scale about the block's centre (1 = full size). */
  scale: number;
  /** Extra downward shift, as a fraction of the frame height. */
  shiftY: number;
};

const ENTER_IDLE: CaptionEnter = { opacity: 1, scale: 1, shiftY: 0 };

/**
 * Appearance animation for a caption `ageSec` seconds after its cue started.
 * Pure and shared by the DOM preview and the canvas burn-in, so they match.
 * `Infinity` (or any age past the animation) returns the resting look.
 */
export function captionEnter(animation: CaptionAnimation, ageSec: number): CaptionEnter {
  if (animation === "none" || !Number.isFinite(ageSec) || ageSec >= ANIMATION_SECONDS) return ENTER_IDLE;
  const p = Math.max(0, Math.min(1, ageSec / ANIMATION_SECONDS));
  const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
  if (animation === "fade") return { opacity: ease, scale: 1, shiftY: 0 };
  if (animation === "pop") {
    // Overshoot just past full size, then settle — and fade in a touch faster.
    return { opacity: Math.min(1, ease * 1.6), scale: 0.72 + 0.28 * ease + 0.06 * Math.sin(Math.PI * p), shiftY: 0 };
  }
  // "rise": slide up into place from a little below.
  return { opacity: ease, scale: 1, shiftY: 0.06 * (1 - ease) };
}

/** A single caption's own placement, overriding the style's default anchor. */
export type CaptionPlacement = {
  position: CaptionPosition;
  offsetX: number;
  offsetY: number;
};

/** The style to draw a caption with: its own placement if it has one. */
export function styleForCaption(style: CaptionStyle, placement?: CaptionPlacement): CaptionStyle {
  return placement
    ? { ...style, position: placement.position, offsetX: placement.offsetX, offsetY: placement.offsetY }
    : style;
}

export type PresetId = "classic" | "modern-box" | "viral";

export type Preset = {
  id: PresetId;
  name: string;
  description: string;
  style: CaptionStyle;
};

export const PRESETS: Preset[] = [
  {
    id: "classic",
    name: "Classic",
    description: "White text with a soft shadow, centred near the bottom.",
    style: {
      fontFamily: "sans",
      weight: 600,
      scale: 0.042,
      textColor: "#ffffff",
      highlightColor: "#fcd34d",
      treatment: "shadow",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "none",
      animation: "fade",
    },
  },
  {
    id: "modern-box",
    name: "Modern Box",
    description: "Bold text on a rounded background box.",
    style: {
      fontFamily: "sans",
      weight: 800,
      scale: 0.05,
      textColor: "#ffffff",
      highlightColor: "#fcd34d",
      treatment: "box",
      boxOpacity: 0.6,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "none",
      animation: "rise",
    },
  },
  {
    id: "viral",
    name: "Viral",
    description: "Big bold text with the spoken word highlighted.",
    style: {
      fontFamily: "sans",
      weight: 800,
      scale: 0.06,
      textColor: "#ffffff",
      highlightColor: "#fcd34d",
      treatment: "shadow",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "highlight",
      animation: "pop",
    },
  },
];

export const DEFAULT_STYLE: CaptionStyle = PRESETS[0].style;

/** True when two styles are visually identical (used to light up the active preset). */
export function sameStyle(a: CaptionStyle, b: CaptionStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.weight === b.weight &&
    a.scale === b.scale &&
    a.textColor === b.textColor &&
    a.highlightColor === b.highlightColor &&
    a.treatment === b.treatment &&
    a.boxOpacity === b.boxOpacity &&
    a.position === b.position &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.emphasis === b.emphasis &&
    a.animation === b.animation
  );
}
