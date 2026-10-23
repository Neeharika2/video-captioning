/**
 * Caption look-and-feel, kept separate from the transcript so a style can be
 * changed without re-transcribing (PLAN.md). Both the browser preview and the
 * burned-in export render from a `CaptionStyle`, so the two stay in sync.
 */

/**
 * The self-hosted faces the editor ships: display looks plus three clean,
 * regular workhorses for everyday captions. All are fetched on demand (see
 * `app/fonts.ts`). No system stacks: the per-script fallbacks in `FONT_STACKS`
 * cover non-Latin scripts.
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
  "anton",
  "bangers",
  "chewy",
] as const;

export type FontFamily = (typeof FONT_FAMILIES)[number];
/**
 * Treatment of the text block: plain, a soft drop shadow, one box behind the
 * whole caption, a glow, a hard comic-book offset shadow, or a tile behind
 * every word.
 */
export type CaptionTreatment = "plain" | "shadow" | "box" | "glow" | "comic" | "tiles";
export type TextCase = "none" | "upper" | "lower";
export type CaptionPosition = "top" | "middle" | "bottom";
/**
 * What marks the word being spoken: its colour, a karaoke fill that sweeps
 * across it, a box that glides from word to word, a highlighter marker that
 * grows under each word, an underline that glides along, a shift from light to
 * bold, or hollow outlined letters that fill solid as they're spoken.
 */
export type CaptionEmphasis = "none" | "color" | "sweep" | "box" | "marker" | "underline" | "weight" | "fill";
/** How text comes on screen. */
export type CaptionAnimation = "none" | "fade" | "pop" | "rise" | "drop" | "slide" | "zoom" | "blur" | "bounce";
/**
 * What the entrance animates: the whole caption when it starts, or each word /
 * letter as it is spoken (unspoken ones stay hidden until then).
 */
export type AnimateBy = "caption" | "word" | "letter";
/** Extra motion on the word being spoken. */
export type WordMotion = "none" | "grow" | "lift" | "hop" | "shake" | "pulse";
/** Idle effect that runs for as long as the caption is on screen. */
export type CaptionLoop = "none" | "float" | "wave" | "shine" | "glitch";

export type CaptionStyle = {
  fontFamily: FontFamily;
  /** 300–800. With `emphasis: "weight"` this is the weight of words not yet spoken. */
  weight: number;
  /** Font size as a fraction of the frame's short side (width for landscape). */
  scale: number;
  textColor: string;
  /**
   * Accent colour: the spoken word's highlight, keywords, the glow, the bottom
   * of a gradient, and the second speaker's colour.
   */
  highlightColor: string;
  treatment: CaptionTreatment;
  /** Box fill colour when `treatment` is "box" or "tiles" (e.g. a pastel pill). */
  boxColor: string;
  /** Background opacity (0–1) when `treatment` is "box" or "tiles". */
  boxOpacity: number;
  /** Draw a dark stroke around the glyphs; combines with any treatment. */
  outline: boolean;
  /** Anchor the block sits at; free dragging adds `offsetX`/`offsetY` on top. */
  position: CaptionPosition;
  /** Free placement offset from the anchor, as a fraction of the frame size. */
  offsetX: number;
  offsetY: number;
  emphasis: CaptionEmphasis;
  /** Entrance animation. */
  animation: CaptionAnimation;
  /** Whether the entrance plays once for the caption or per word / letter as spoken. */
  animateBy: AnimateBy;
  wordMotion: WordMotion;
  loop: CaptionLoop;
  /** Show words that haven't been spoken yet faded back. */
  dimUpcoming: boolean;
  /** Upper- or lowercase the caption text (a no-op for scripts without letter case). */
  textCase: TextCase;
  /** Most words on screen at once (1–4). Changing it regroups the captions. */
  wordsPerCaption: number;
  /** Pick out the caption's key words (numbers, long content words) and set them bigger in the accent colour. */
  keywords: boolean;
  /** Fill the text with a top-to-bottom gradient from the text colour to the accent colour. */
  gradient: boolean;
  /** Add the other script (original ↔ English letters) as a smaller line underneath. */
  bilingual: boolean;
  /** Colour each speaker's captions differently (needs "Detect speakers"). */
  speakerColors: boolean;
};

/** Words per caption the picker offers. */
export const WORDS_PER_CAPTION = [1, 2, 3, 4] as const;
export const DEFAULT_WORDS_PER_CAPTION = 4;

/** Apply the style's text case. */
export function applyCase(style: Pick<CaptionStyle, "textCase">, text: string): string {
  if (style.textCase === "upper") return text.toUpperCase();
  if (style.textCase === "lower") return text.toLowerCase();
  return text;
}

/**
 * Colour for the `index`-th speaker (in order of first appearance): the text
 * colour, then the accent, then a fixed palette.
 */
export function speakerColor(style: CaptionStyle, index: number): string {
  const palette = [style.textColor, style.highlightColor, "#f9a8d4", "#86efac", "#fdba74", "#c4b5fd"];
  return palette[((index % palette.length) + palette.length) % palette.length];
}

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
  anton: `Anton, ${SCRIPT_FALLBACKS}, sans-serif`,
  bangers: `Bangers, ${SCRIPT_FALLBACKS}, sans-serif`,
  chewy: `Chewy, ${SCRIPT_FALLBACKS}, sans-serif`,
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
  anton: "Anton — tall condensed",
  bangers: "Bangers — comic book",
  chewy: "Chewy — chunky and fun",
};

/** Order of the font picker, grouped loosely by mood. */
export const FONT_GROUPS: { label: string; fonts: readonly FontFamily[] }[] = [
  {
    label: "Clean & regular",
    fonts: ["inter", "poppins", "montserrat"],
  },
  {
    label: "Bold & viral",
    fonts: ["anton", "bungee", "archivoBlack", "bowlbyOne", "chewy", "bangers", "permanentMarker", "lilitaOne", "righteous"],
  },
  {
    label: "Cinematic & modern",
    fonts: ["audiowide", "syne", "dmSerifDisplay", "monoton"],
  },
];

export const WEIGHT_LABELS: Record<number, string> = {
  300: "Light",
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
  drop: "Drop",
  slide: "Slide",
  zoom: "Zoom",
  blur: "Blur",
  bounce: "Bounce",
};

export const TREATMENT_LABELS: Record<CaptionTreatment, string> = {
  plain: "None",
  shadow: "Shadow",
  box: "Box",
  glow: "Glow",
  comic: "Comic",
  tiles: "Tiles",
};

export const TEXT_CASE_LABELS: Record<TextCase, string> = {
  none: "Aa",
  upper: "AA",
  lower: "aa",
};

export const ANIMATE_BY_LABELS: Record<AnimateBy, string> = {
  caption: "Caption",
  word: "Word",
  letter: "Letter",
};

export const EMPHASIS_LABELS: Record<CaptionEmphasis, string> = {
  none: "None",
  color: "Colour",
  sweep: "Karaoke",
  box: "Box",
  marker: "Marker",
  underline: "Underline",
  weight: "Bold",
  fill: "Fill",
};

export const WORD_MOTION_LABELS: Record<WordMotion, string> = {
  none: "None",
  grow: "Grow",
  lift: "Lift",
  hop: "Hop",
  shake: "Shake",
  pulse: "Pulse",
};

export const LOOP_LABELS: Record<CaptionLoop, string> = {
  none: "None",
  float: "Float",
  wave: "Wave",
  shine: "Shine",
  glitch: "Glitch",
};

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

export type PresetCategory = "clean" | "highlight" | "punchy" | "stylised" | "language";

export type PresetId =
  | "classic-reels"
  | "podcast-clean"
  | "weight-shift"
  | "cinematic"
  | "soft-aesthetic"
  | "karaoke-highlight"
  | "glide-box"
  | "highlighter"
  | "creator-pop"
  | "outline-fill"
  | "word-tiles"
  | "big-word"
  | "rapid-fire"
  | "keyword-punch"
  | "bold-viral"
  | "impact-words"
  | "comic"
  | "neon-creator"
  | "sunset-gradient"
  | "letter-wave"
  | "bilingual"
  | "speaker-duo";

export type Preset = {
  id: PresetId;
  name: string;
  description: string;
  category: PresetCategory;
  style: CaptionStyle;
};

/** What every preset starts from; each one only spells out what makes it different. */
export const BASE: Omit<CaptionStyle, "fontFamily"> = {
  weight: 600,
  scale: 0.046,
  textColor: "#ffffff",
  highlightColor: "#fcd34d",
  treatment: "shadow",
  boxColor: "#000000",
  boxOpacity: 0.55,
  outline: false,
  position: "bottom",
  offsetX: 0,
  offsetY: 0,
  emphasis: "none",
  animation: "fade",
  animateBy: "caption",
  wordMotion: "none",
  loop: "none",
  dimUpcoming: false,
  textCase: "none",
  wordsPerCaption: DEFAULT_WORDS_PER_CAPTION,
  keywords: false,
  gradient: false,
  bilingual: false,
  speakerColors: false,
};

/** The style new projects start on: the "Classic Reels" preset (`PRESETS[0]`). */
export const DEFAULT_STYLE: CaptionStyle = { ...BASE, fontFamily: "righteous", scale: 0.044 };

/** True when two styles are visually identical (used to light up the active preset). */
export function sameStyle(a: CaptionStyle, b: CaptionStyle): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof CaptionStyle)[]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

const ANIMATIONS = Object.keys(ANIMATION_LABELS) as CaptionAnimation[];
const ANIMATE_BYS = Object.keys(ANIMATE_BY_LABELS) as AnimateBy[];
const EMPHASES = Object.keys(EMPHASIS_LABELS) as CaptionEmphasis[];
const WORD_MOTIONS = Object.keys(WORD_MOTION_LABELS) as WordMotion[];
const LOOPS = Object.keys(LOOP_LABELS) as CaptionLoop[];
const CASES = Object.keys(TEXT_CASE_LABELS) as TextCase[];
const TREATMENTS = Object.keys(TREATMENT_LABELS) as CaptionTreatment[];
const POSITIONS: readonly CaptionPosition[] = ["top", "middle", "bottom"];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const hex = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

/**
 * Rebuild a style read from storage, keeping only valid values and filling the
 * rest from `fallback`. Also upgrades older saves: the single "outline"
 * treatment (outline is its own axis now), the old on/off "highlight", and the
 * old `uppercase` flag (now `textCase`).
 */
export function normalizeStyle(raw: unknown, fallback: CaptionStyle = DEFAULT_STYLE): CaptionStyle {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const r = raw as Record<string, unknown>;
  const legacyOutline = r.treatment === "outline";
  const legacyCase = typeof r.uppercase === "boolean" ? (r.uppercase ? "upper" : "none") : fallback.textCase;
  const words = Math.round(num(r.wordsPerCaption, fallback.wordsPerCaption));
  return {
    fontFamily: oneOf(r.fontFamily, FONT_FAMILIES, fallback.fontFamily),
    weight: num(r.weight, fallback.weight),
    scale: Math.min(MAX_CAPTION_SCALE, Math.max(MIN_CAPTION_SCALE, num(r.scale, fallback.scale))),
    textColor: hex(r.textColor, fallback.textColor),
    highlightColor: hex(r.highlightColor, fallback.highlightColor),
    treatment: legacyOutline ? "plain" : oneOf(r.treatment, TREATMENTS, fallback.treatment),
    boxColor: hex(r.boxColor, fallback.boxColor),
    boxOpacity: Math.min(1, Math.max(0, num(r.boxOpacity, fallback.boxOpacity))),
    outline: legacyOutline || bool(r.outline, fallback.outline),
    position: oneOf(r.position, POSITIONS, fallback.position),
    offsetX: num(r.offsetX, fallback.offsetX),
    offsetY: num(r.offsetY, fallback.offsetY),
    emphasis: r.emphasis === "highlight" ? "color" : oneOf(r.emphasis, EMPHASES, fallback.emphasis),
    animation: oneOf(r.animation, ANIMATIONS, fallback.animation),
    animateBy: oneOf(r.animateBy, ANIMATE_BYS, fallback.animateBy),
    wordMotion: oneOf(r.wordMotion, WORD_MOTIONS, fallback.wordMotion),
    loop: oneOf(r.loop, LOOPS, fallback.loop),
    dimUpcoming: bool(r.dimUpcoming, fallback.dimUpcoming),
    textCase: oneOf(r.textCase, CASES, legacyCase),
    wordsPerCaption: (WORDS_PER_CAPTION as readonly number[]).includes(words) ? words : fallback.wordsPerCaption,
    keywords: bool(r.keywords, fallback.keywords),
    gradient: bool(r.gradient, fallback.gradient),
    bilingual: bool(r.bilingual, fallback.bilingual),
    speakerColors: bool(r.speakerColors, fallback.speakerColors),
  };
}
