/**
 * Caption look-and-feel, kept separate from the transcript so a style can be
 * changed without re-transcribing (PLAN.md). Both the browser preview and the
 * burned-in export render from a `CaptionStyle`, so the two stay in sync.
 */

/**
 * The self-hosted faces the editor ships: ten modern display looks plus three
 * clean, regular workhorses for everyday captions. All are fetched on demand
 * (see `app/fonts.ts`) and each has its own character so the preset gallery
 * reads as ten genuinely different styles. No system stacks: the per-script
 * fallbacks in `FONT_STACKS` cover non-Latin scripts.
 */
export const FONT_FAMILIES = [
  "inter",
  "poppins",
  "montserrat",
  "bungee",
  "archivoBlack",
  "bowlbyOne",
  "permanentMarker",
  "lilitaOne",
  "righteous",
  "audiowide",
  "syne",
  "dmSerifDisplay",
  "monoton",
] as const;

export type FontFamily = (typeof FONT_FAMILIES)[number];
export type CaptionTreatment = "plain" | "shadow" | "box" | "glow";
export type CaptionPosition = "top" | "middle" | "bottom";
export type CaptionEmphasis = "none" | "highlight";
/** How a caption comes on screen when its cue starts. */
export type CaptionAnimation = "none" | "fade" | "pop" | "rise";

export type CaptionStyle = {
  fontFamily: FontFamily;
  /** 400, 500, 600 or 800. */
  weight: number;
  /** Font size as a fraction of the frame's short side (width for landscape). */
  scale: number;
  textColor: string;
  /** Colour of the word being spoken when `emphasis` is "highlight". Also the glow colour for `treatment: "glow"`. */
  highlightColor: string;
  treatment: CaptionTreatment;
  /** Box fill colour when `treatment` is "box" (e.g. a pastel pill). */
  boxColor: string;
  /** Background opacity (0–1) when `treatment` is "box". */
  boxOpacity: number;
  /** Draw a dark stroke around the glyphs; combines with any treatment. */
  outline: boolean;
  /** Anchor the block sits at; free dragging adds `offsetX`/`offsetY` on top. */
  position: CaptionPosition;
  /** Free placement offset from the anchor, as a fraction of the frame size. */
  offsetX: number;
  offsetY: number;
  emphasis: CaptionEmphasis;
  /** Appearance animation, played when the cue first shows. */
  animation: CaptionAnimation;
  /** Uppercase the caption text (a no-op for scripts without letter case). */
  uppercase: boolean;
};

/** Max share of the frame width a caption block may occupy. */
export const CAPTION_MAX_WIDTH = 0.88;

/** Smallest and largest per-caption font scale (fraction of the short side). */
export const MIN_CAPTION_SCALE = 0.02;
export const MAX_CAPTION_SCALE = 0.12;

/**
 * Per-script fallbacks for the languages our transcriptions actually meet.
 * The browser resolves fonts per glyph, so a Latin display face never masks a
 * Telugu or Devanagari one; Noto is the common denominator on Linux/Android and
 * the named OS faces cover Windows/macOS when Noto isn't installed. The final
 * generic family still catches anything not listed here.
 */
const SCRIPT_FALLBACKS = [
  '"Noto Sans Telugu", "Nirmala UI", "Gautami"',
  '"Noto Sans Devanagari", "Nirmala UI", "Mangal"',
  '"Noto Sans Tamil", "Nirmala UI", "Latha"',
  '"Noto Sans Bengali", "Nirmala UI", "Vrinda"',
  '"Noto Sans Kannada", "Nirmala UI", "Tunga"',
  '"Noto Sans Malayalam", "Nirmala UI", "Kartika"',
  '"Noto Sans Gujarati", "Nirmala UI", "Shruti"',
  '"Noto Sans Gurmukhi", "Nirmala UI", "Raavi"',
  '"Noto Sans Arabic", "Segoe UI", "Geeza Pro"',
  '"Noto Sans Hebrew", "Segoe UI", "Arial Hebrew"',
  '"Noto Sans Thai", "Leelawadee UI", "Thonburi"',
  '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo"',
  '"Noto Sans JP", "Yu Gothic", "Hiragino Kaku Gothic ProN"',
  '"Noto Sans SC", "Microsoft YaHei", "PingFang SC"',
].join(", ");

/**
 * Font stacks, not single families: every display face is followed by the shared
 * per-script fallbacks so code-switched captions shape correctly in both preview
 * and export. The family names match next/font's @font-face.
 */
export const FONT_STACKS: Record<FontFamily, string> = {
  inter: `Inter, ${SCRIPT_FALLBACKS}, sans-serif`,
  poppins: `Poppins, ${SCRIPT_FALLBACKS}, sans-serif`,
  montserrat: `Montserrat, ${SCRIPT_FALLBACKS}, sans-serif`,
  bungee: `Bungee, ${SCRIPT_FALLBACKS}, sans-serif`,
  archivoBlack: `"Archivo Black", ${SCRIPT_FALLBACKS}, sans-serif`,
  bowlbyOne: `"Bowlby One SC", ${SCRIPT_FALLBACKS}, sans-serif`,
  permanentMarker: `"Permanent Marker", ${SCRIPT_FALLBACKS}, sans-serif`,
  lilitaOne: `"Lilita One", ${SCRIPT_FALLBACKS}, sans-serif`,
  righteous: `Righteous, ${SCRIPT_FALLBACKS}, sans-serif`,
  audiowide: `Audiowide, ${SCRIPT_FALLBACKS}, sans-serif`,
  syne: `Syne, ${SCRIPT_FALLBACKS}, sans-serif`,
  dmSerifDisplay: `"DM Serif Display", ${SCRIPT_FALLBACKS}, serif`,
  monoton: `Monoton, ${SCRIPT_FALLBACKS}, sans-serif`,
};

export const FONT_LABELS: Record<FontFamily, string> = {
  inter: "Inter — neutral and readable",
  poppins: "Poppins — clean geometric",
  montserrat: "Montserrat — modern classic",
  bungee: "Bungee — arcade headlines",
  archivoBlack: "Archivo Black — massive weight",
  bowlbyOne: "Bowlby One SC — retro display",
  permanentMarker: "Permanent Marker — handwritten",
  lilitaOne: "Lilita One — playful extra-bold",
  righteous: "Righteous — retro-futuristic",
  audiowide: "Audiowide — futuristic tech",
  syne: "Syne — art-directed",
  dmSerifDisplay: "DM Serif Display — editorial",
  monoton: "Monoton — neon sign",
};

/** Order of the font picker, grouped loosely by mood. */
export const FONT_GROUPS: { label: string; fonts: readonly FontFamily[] }[] = [
  {
    label: "Clean & regular",
    fonts: ["inter", "poppins", "montserrat"],
  },
  {
    label: "Bold & viral",
    fonts: ["bungee", "archivoBlack", "bowlbyOne", "permanentMarker", "lilitaOne", "righteous"],
  },
  {
    label: "Cinematic & modern",
    fonts: ["audiowide", "syne", "dmSerifDisplay", "monoton"],
  },
];

export const WEIGHT_LABELS: Record<number, string> = {
  400: "Regular",
  500: "Medium",
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

/** `#rrggbb` + opacity → an `rgba(...)` string. Shared so the preview and the canvas match. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const a = Math.max(0, Math.min(1, alpha));
  if (!m) return `rgba(0, 0, 0, ${a})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
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

/**
 * The style to draw a caption with: its own placement and font scale when it
 * has them, otherwise the style's defaults.
 */
export function styleForCaption(
  style: CaptionStyle,
  placement?: CaptionPlacement,
  scale?: number,
): CaptionStyle {
  if (!placement && scale === undefined) return style;
  return {
    ...style,
    ...(placement ? { position: placement.position, offsetX: placement.offsetX, offsetY: placement.offsetY } : {}),
    ...(scale !== undefined ? { scale } : {}),
  };
}

export type PresetId =
  | "classic-reels"
  | "karaoke-highlight"
  | "bold-viral"
  | "podcast-clean"
  | "neon-creator"
  | "cinematic"
  | "soft-aesthetic"
  | "creator-pop"
  | "bilingual"
  | "impact-words";

export type Preset = {
  id: PresetId;
  name: string;
  description: string;
  style: CaptionStyle;
};

/**
 * Ten one-click looks spanning the common short-form aesthetics. Every preset is
 * just a combination of the same axes, so any of them can be fine-tuned (font,
 * size, colour, position, animation) afterwards without leaving the model.
 */
export const PRESETS: Preset[] = [
  {
    id: "classic-reels",
    name: "Classic Reels",
    description: "White bold text with a soft shadow — everyday reels, talking heads.",
    style: {
      fontFamily: "righteous",
      weight: 600,
      scale: 0.044,
      textColor: "#ffffff",
      highlightColor: "#fcd34d",
      treatment: "shadow",
      outline: false,
      boxColor: "#000000",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "none",
      animation: "fade",
      uppercase: false,
    },
  },
  {
    id: "karaoke-highlight",
    name: "Karaoke Highlight",
    description: "White text with the spoken word lit up in yellow — podcasts, storytelling.",
    style: {
      fontFamily: "archivoBlack",
      weight: 700,
      scale: 0.05,
      textColor: "#ffffff",
      highlightColor: "#fde047",
      treatment: "shadow",
      outline: false,
      boxColor: "#000000",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "highlight",
      animation: "fade",
      uppercase: false,
    },
  },
  {
    id: "bold-viral",
    name: "Bold Viral",
    description: "Heavy uppercase with a thick black outline — reactions, comedy, high energy.",
    style: {
      fontFamily: "bungee",
      weight: 800,
      scale: 0.058,
      textColor: "#ffffff",
      highlightColor: "#fde047",
      treatment: "plain",
      outline: true,
      boxColor: "#000000",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "none",
      animation: "pop",
      uppercase: true,
    },
  },
  {
    id: "podcast-clean",
    name: "Podcast Clean",
    description: "Medium-weight white in a roomy two-line layout — interviews, education.",
    style: {
      fontFamily: "syne",
      weight: 500,
      scale: 0.042,
      textColor: "#ffffff",
      highlightColor: "#fcd34d",
      treatment: "plain",
      outline: false,
      boxColor: "#000000",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "none",
      animation: "fade",
      uppercase: false,
    },
  },
  {
    id: "neon-creator",
    name: "Neon Creator",
    description: "Bold text with a cyan glow and a lit-up word — gaming, tech, futuristic.",
    style: {
      fontFamily: "audiowide",
      weight: 800,
      scale: 0.052,
      textColor: "#ffffff",
      highlightColor: "#22d3ee",
      treatment: "glow",
      outline: false,
      boxColor: "#000000",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "highlight",
      animation: "pop",
      uppercase: false,
    },
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Elegant serif, restrained size, lower-centre — travel, film, emotion.",
    style: {
      fontFamily: "dmSerifDisplay",
      weight: 500,
      scale: 0.04,
      textColor: "#f5f5f4",
      highlightColor: "#e7c590",
      treatment: "shadow",
      outline: false,
      boxColor: "#000000",
      boxOpacity: 0.5,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "none",
      animation: "fade",
      uppercase: false,
    },
  },
  {
    id: "soft-aesthetic",
    name: "Soft Aesthetic",
    description: "Rounded text on a pastel pill — lifestyle, beauty, daily vlogs.",
    style: {
      fontFamily: "lilitaOne",
      weight: 600,
      scale: 0.046,
      textColor: "#3f3f46",
      highlightColor: "#db2777",
      treatment: "box",
      outline: false,
      boxColor: "#fce7f3",
      boxOpacity: 0.92,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "none",
      animation: "rise",
      uppercase: false,
    },
  },
  {
    id: "creator-pop",
    name: "Creator Pop",
    description: "White text with a green active word and a pop-in — personal brands, tutorials.",
    style: {
      fontFamily: "permanentMarker",
      weight: 700,
      scale: 0.05,
      textColor: "#ffffff",
      highlightColor: "#4ade80",
      treatment: "shadow",
      outline: false,
      boxColor: "#000000",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "highlight",
      animation: "pop",
      uppercase: false,
    },
  },
  {
    id: "bilingual",
    name: "Bilingual",
    description: "Two-line layout built for Telugu–English code-switching and mixed speech.",
    style: {
      fontFamily: "bowlbyOne",
      weight: 600,
      scale: 0.046,
      textColor: "#ffffff",
      highlightColor: "#fcd34d",
      treatment: "shadow",
      outline: false,
      boxColor: "#000000",
      boxOpacity: 0.6,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "none",
      animation: "fade",
      uppercase: false,
    },
  },
  {
    id: "impact-words",
    name: "Impact Words",
    description: "Large uppercase with orange keywords — hooks, motivational, dramatic edits.",
    style: {
      fontFamily: "monoton",
      weight: 800,
      scale: 0.056,
      textColor: "#ffffff",
      highlightColor: "#fb923c",
      treatment: "shadow",
      outline: false,
      boxColor: "#000000",
      boxOpacity: 0.55,
      position: "bottom",
      offsetX: 0,
      offsetY: 0,
      emphasis: "highlight",
      animation: "pop",
      uppercase: true,
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
    a.boxColor === b.boxColor &&
    a.boxOpacity === b.boxOpacity &&
    a.outline === b.outline &&
    a.position === b.position &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.emphasis === b.emphasis &&
    a.animation === b.animation &&
    a.uppercase === b.uppercase
  );
}
