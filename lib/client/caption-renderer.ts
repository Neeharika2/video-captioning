/**
 * Draws a caption onto a video frame (canvas) for burned-in exports.
 *
 * Text is drawn with the browser's own fonts, so Telugu and other complex
 * scripts are shaped correctly without shipping font files.
 */
import type { Caption } from "../types";

export const CAPTION_FONT_STACK =
  'system-ui, "Noto Sans", "Noto Sans Telugu", "Nirmala UI", "Segoe UI", Roboto, Arial, sans-serif';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Index of the caption showing at time `t`, or -1. Captions must be sorted by start. */
export function findCaptionAt(captions: Caption[], t: number): number {
  let lo = 0;
  let hi = captions.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (captions[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && t < captions[found].end ? found : -1;
}

/** Wrap words to fit `maxWidth` pixels using the context's current font. */
function wrapToWidth(ctx: Ctx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = w;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw `caption` at the bottom of a `width`×`height` frame: white text on a
 * translucent dark box per line. Scales with the frame, so vertical videos
 * and 4K both look right.
 */
export function drawCaption(
  ctx: Ctx,
  caption: Caption,
  width: number,
  height: number,
  /** Index into `caption.words` of the word to highlight, or -1 for none. */
  highlightWord = -1,
) {
  const shortSide = Math.min(width, height);
  let fontSize = Math.max(14, Math.round(shortSide * 0.055));
  const maxWidth = width * 0.88;
  const text = caption.lines?.length ? caption.lines.join(" ") : caption.text;

  // Prefer the editor's line breaks; re-wrap by pixel width if they don't fit,
  // shrinking the font if that would take more than 3 lines.
  let lines: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    ctx.font = `600 ${fontSize}px ${CAPTION_FONT_STACK}`;
    const preferred = caption.lines?.length ? caption.lines : [caption.text];
    lines = preferred.every((l) => ctx.measureText(l).width <= maxWidth) ? preferred : wrapToWidth(ctx, text, maxWidth);
    if (lines.length <= 3) break;
    fontSize = Math.round(fontSize * 0.85);
  }

  const lineHeight = Math.round(fontSize * 1.3);
  const padX = Math.round(fontSize * 0.4);
  const padY = Math.round(fontSize * 0.12);
  const bottom = height - Math.round(height * 0.07);
  const top = bottom - lineHeight * lines.length;

  // Highlighting needs line tokens to line up 1:1 with the timed words; skip
  // it if the text was edited so they no longer match.
  const tokens = lines.map((l) => l.split(/\s+/).filter(Boolean));
  const canHighlight = highlightWord >= 0 && tokens.flat().length === caption.words.length;
  let wordIndex = 0;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    const y = top + i * lineHeight;
    const w = ctx.measureText(line).width;
    const x = width / 2 - w / 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    // Boxes of neighbouring lines touch but don't overlap (overlap shows as a darker band).
    const boxTop = y - (i === 0 ? padY : 0);
    const boxBottom = y + lineHeight + (i === lines.length - 1 ? padY : 0);
    ctx.fillRect(x - padX, boxTop, w + padX * 2, boxBottom - boxTop);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, x, y + lineHeight / 2);

    if (canHighlight) {
      const k = highlightWord - wordIndex;
      if (k >= 0 && k < tokens[i].length) {
        const prefix = tokens[i].slice(0, k).join(" ");
        const dx = prefix ? ctx.measureText(prefix + " ").width : 0;
        ctx.fillStyle = HIGHLIGHT_COLOR;
        ctx.fillText(tokens[i][k], x + dx, y + lineHeight / 2);
      }
      wordIndex += tokens[i].length;
    }
  });
}

export const HIGHLIGHT_COLOR = "#fcd34d";

/** Index into `caption.words` of the word being spoken at `t` (the last one started), or -1. */
export function spokenWordAt(caption: Caption, t: number): number {
  let found = -1;
  for (let i = 0; i < caption.words.length && caption.words[i].start <= t; i++) found = i;
  return found;
}
