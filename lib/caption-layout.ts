/**
 * Caption line layout, shared by the DOM preview and the canvas burn-in so a
 * caption breaks and shrinks identically in both. Measuring is injected, which
 * lets the preview use an offscreen canvas and the renderer use its own context.
 */
import { CAPTION_MAX_WIDTH, applyCase, cssFont, fontSizeFor, type CaptionStyle } from "./caption-style";
import type { Caption } from "./types";

export type CaptionLayout = {
  /** Font size actually used (shrunk if the text would need more than 3 lines). */
  fontSize: number;
  lines: string[];
  /** Bilingual second line(s): the other script, smaller, under the caption. */
  sub?: { fontSize: number; lines: string[] };
};

/** Bilingual second line is this much smaller than the caption. */
export const SUB_SCALE = 0.62;
/** Weight that spoken words switch to with `emphasis: "weight"`. */
export const EMPHASIS_WEIGHT = 800;

/**
 * The caption in the other script, or null when there's nothing different to
 * show (an English-only video, words without an alternate spelling, or a
 * caption whose text was edited).
 */
export function altText(caption: Caption): string | null {
  if (!caption.words.length || caption.words.some((w) => !w.alt)) return null;
  const main = caption.words.map((w) => w.text).join(" ");
  // An edited caption no longer says what its words say: drop the stale line.
  if (caption.text.trim() !== main.trim()) return null;
  const alt = caption.words.map((w) => w.alt).join(" ");
  return alt.trim().toLowerCase() === main.trim().toLowerCase() ? null : alt;
}

/** Width of `text` in pixels when drawn with the CSS font shorthand `font`. */
export type MeasureText = (text: string, font: string) => number;

/**
 * Prefer the editor's line breaks; re-wrap by pixel width when they no longer
 * fit, and shrink the font if the result would take more than three lines.
 * Both renderers call this, so resizing a caption can't drift between them.
 */
export function layoutCaption(
  style: CaptionStyle,
  caption: Caption,
  width: number,
  height: number,
  measure: MeasureText,
): CaptionLayout {
  const maxWidth = width * CAPTION_MAX_WIDTH;
  const rawText = caption.lines?.length ? caption.lines.join(" ") : caption.text;
  const text = applyCase(style, rawText);
  const preferred = caption.lines?.length ? caption.lines.map((line) => applyCase(style, line)) : [text];
  // Weight shift ends with every word bold, so make room for that up front.
  const measureStyle = style.emphasis === "weight" ? { ...style, weight: Math.max(style.weight, EMPHASIS_WEIGHT) } : style;

  let fontSize = fontSizeFor(style, width, height);
  let lines: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const font = cssFont(measureStyle, fontSize);
    lines = preferred.every((line) => measure(line, font) <= maxWidth)
      ? preferred
      : wrapToWidth(text, maxWidth, (line) => measure(line, font));
    if (lines.length <= 3) break;
    fontSize = Math.round(fontSize * 0.85);
  }

  const alt = style.bilingual ? altText(caption) : null;
  if (!alt) return { fontSize, lines };
  const subSize = Math.max(10, Math.round(fontSize * SUB_SCALE));
  const subFont = cssFont({ ...style, weight: Math.min(style.weight, 600) }, subSize);
  const subLines = wrapToWidth(applyCase(style, alt), maxWidth, (line) => measure(line, subFont)).slice(0, 2);
  return { fontSize, lines, sub: { fontSize: subSize, lines: subLines } };
}

/** Greedy word wrap to `maxWidth`, using the supplied measurement function. */
export function wrapToWidth(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}
