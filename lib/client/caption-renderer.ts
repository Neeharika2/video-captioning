/**
 * Draws a caption onto a video frame (canvas) for burned-in exports.
 *
 * This is the single source of truth for caption layout, so the browser preview
 * and the exported video look the same. Text is drawn with the browser's own
 * fonts (see `fontStack`), so Telugu and other complex scripts shape correctly.
 */
import type { Caption } from "../types";
import { blockTop, cssFont, fontSizeFor, type CaptionStyle, CAPTION_MAX_WIDTH } from "../caption-style";

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

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof (ctx as CanvasRenderingContext2D).roundRect === "function") {
    (ctx as CanvasRenderingContext2D).roundRect(x, y, w, h, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
  }
  ctx.closePath();
}

/**
 * Draw `caption` onto a `width`×`height` frame using `style`. The active word
 * (index into `caption.words`) is coloured when the style highlights words.
 */
export function drawCaption(
  ctx: Ctx,
  caption: Caption,
  width: number,
  height: number,
  style: CaptionStyle,
  highlightWord = -1,
) {
  const maxWidth = width * CAPTION_MAX_WIDTH;
  const text = caption.lines?.length ? caption.lines.join(" ") : caption.text;

  // Prefer the editor's line breaks; re-wrap by pixel width if they don't fit,
  // shrinking the font if that would take more than 3 lines.
  let fontSize = fontSizeFor(style, width, height);
  let lines: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    ctx.font = cssFont(style, fontSize);
    const preferred = caption.lines?.length ? caption.lines : [caption.text];
    lines = preferred.every((l) => ctx.measureText(l).width <= maxWidth) ? preferred : wrapToWidth(ctx, text, maxWidth);
    if (lines.length <= 3) break;
    fontSize = Math.round(fontSize * 0.85);
  }
  ctx.font = cssFont(style, fontSize);

  const lineHeight = Math.round(fontSize * 1.3);
  const padX = Math.round(fontSize * 0.5);
  const padY = Math.round(fontSize * 0.3);
  const blockHeight = lineHeight * lines.length;
  const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const top = blockTop(style, height, blockHeight);

  // Background box (one rounded box behind the whole block).
  if (style.treatment === "box") {
    ctx.fillStyle = `rgba(0, 0, 0, ${style.boxOpacity})`;
    roundedRect(ctx, (width - maxLineWidth) / 2 - padX, top - padY, maxLineWidth + padX * 2, blockHeight + padY * 2, fontSize * 0.35);
    ctx.fill();
  }

  // Effects applied to the glyphs themselves.
  if (style.treatment === "shadow") {
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = fontSize * 0.35;
    ctx.shadowOffsetY = Math.round(fontSize * 0.08);
  }
  const outline = style.treatment === "outline";
  if (outline) {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, fontSize * 0.14);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    const y = top + i * lineHeight + lineHeight / 2;
    if (outline) ctx.strokeText(line, width / 2, y);
    ctx.fillStyle = style.textColor;
    ctx.fillText(line, width / 2, y);
  });

  // Highlighting needs line tokens to line up 1:1 with the timed words; skip
  // it if the text was edited so they no longer match.
  if (style.emphasis === "highlight" && highlightWord >= 0) {
    const tokens = lines.map((l) => l.split(/\s+/).filter(Boolean));
    if (tokens.flat().length === caption.words.length) {
      let wordIndex = 0;
      ctx.textAlign = "left";
      ctx.fillStyle = style.highlightColor;
      lines.forEach((line, i) => {
        const k = highlightWord - wordIndex;
        if (k >= 0 && k < tokens[i].length) {
          const y = top + i * lineHeight + lineHeight / 2;
          const startX = width / 2 - ctx.measureText(line).width / 2;
          const prefix = tokens[i].slice(0, k).join(" ");
          const dx = prefix ? ctx.measureText(prefix + " ").width : 0;
          const word = tokens[i][k];
          if (outline) ctx.strokeText(word, startX + dx, y);
          ctx.fillText(word, startX + dx, y);
        }
        wordIndex += tokens[i].length;
      });
      ctx.textAlign = "center";
    }
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** Index into `caption.words` of the word being spoken at `t` (the last one started), or -1. */
export function spokenWordAt(caption: Caption, t: number): number {
  let found = -1;
  for (let i = 0; i < caption.words.length && caption.words[i].start <= t; i++) found = i;
  return found;
}
