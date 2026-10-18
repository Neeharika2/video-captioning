/**
 * Caption look-and-feel, kept separate from the transcript so a style can be
 * changed without re-transcribing (PLAN.md). Both the browser preview and the
 * burned-in export render from a `CaptionStyle`, so the two stay in sync.
 */

export type FontFamily = "sans" | "serif" | "mono";
export type CaptionTreatment = "plain" | "shadow" | "outline" | "box";
export type CaptionPosition = "top" | "middle" | "bottom";
export type CaptionEmphasis = "none" | "highlight";

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
  position: CaptionPosition;
  emphasis: CaptionEmphasis;
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
      emphasis: "none",
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
      emphasis: "none",
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
      emphasis: "highlight",
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
    a.emphasis === b.emphasis
  );
}
