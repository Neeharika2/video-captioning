/**
 * Caption line layout, shared by the DOM preview and the canvas burn-in so a
 * caption breaks and shrinks identically in both. Measuring is injected, which
 * lets the preview use an offscreen canvas and the renderer use its own context.
 */
import { CAPTION_MAX_WIDTH, cssFont, fontSizeFor, type CaptionStyle } from "./caption-style";
import type { Caption } from "./types";

export type CaptionLayout = {
  /** Font size actually used (shrunk if the text would need more than 3 lines). */
  fontSize: number;
  lines: string[];
};

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
  const text = style.uppercase ? rawText.toUpperCase() : rawText;
  const preferred = caption.lines?.length
    ? caption.lines.map((line) => (style.uppercase ? line.toUpperCase() : line))
    : [text];

  let fontSize = fontSizeFor(style, width, height);
  let lines: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const font = cssFont(style, fontSize);
    lines = preferred.every((line) => measure(line, font) <= maxWidth)
      ? preferred
      : wrapToWidth(text, maxWidth, (line) => measure(line, font));
    if (lines.length <= 3) break;
    fontSize = Math.round(fontSize * 0.85);
  }
  return { fontSize, lines };
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
