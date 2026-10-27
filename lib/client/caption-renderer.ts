/**
 * Draws a caption onto a canvas: the browser preview's overlay and every frame
 * of the burned-in export go through `drawCaption`, so the two always match,
 * effects included. Text is drawn with the browser's own fonts (see
 * `fontStack`), so Telugu and other complex scripts shape correctly.
 *
 * A frame is a pure function of the caption, the style and the time, so
 * scrubbing, replaying and exporting all land on the same picture.
 */
import type { Caption } from "../types";
import { EMPHASIS_WEIGHT, layoutCaption } from "../caption-layout";
import {
  CAPTION_MAX_WIDTH,
  applyCase,
  blockLeft,
  blockTop,
  cssFont,
  speakerColor,
  withAlpha,
  type CaptionStyle,
  type CaptionEmphasis,
  type TextCase,
} from "../caption-style";
import {
  ENTER_SECONDS,
  REST,
  activeToken,
  canSplitLetters,
  clamp01,
  contrastText,
  easeOutBack,
  easeOutCubic,
  enterPose,
  glitchAmount,
  isRtl,
  letterStagger,
  loopBlockPose,
  motionPose,
  punchlineIndices,
  shinePosition,
  splitGraphemes,
  tokenSpeakers,
  tokenTimings,
  waveOffset,
  type Pose,
} from "../caption-effects";

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

/** Displace the drawing space by `pose`, pivoting about (`cx`, `cy`). */
function applyPose(ctx: Ctx, pose: Pose, cx: number, cy: number, em: number) {
  if (pose === REST) return;
  ctx.translate(cx + pose.dx * em, cy + pose.dy * em);
  if (pose.rotate) ctx.rotate(pose.rotate);
  if (pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
  ctx.translate(-cx, -cy);
  if (pose.opacity < 1) ctx.globalAlpha *= Math.max(0, pose.opacity);
}

export type DrawOptions = {
  /**
   * Paused or scrubbing: entrances and one-shot motions show their resting
   * look, so the whole caption is readable and easy to grab. The spoken-word
   * highlight still follows `t`.
   */
  still?: boolean;
};

/** One word on screen, in block space (before any animation). */
type Token = {
  text: string;
  /** Slot the word sits in (wide enough for its boldest look). */
  slotX: number;
  slotW: number;
  /** Left edge and width of the word as drawn this frame, centred in its slot. */
  x: number;
  w: number;
  /** Vertical centre of its line. */
  y: number;
  line: number;
  rtl: boolean;
  /** Font size in px (keywords are bigger) and the CSS font it's drawn in. */
  size: number;
  font: string;
  keyword: boolean;
  /** Style this word is drawn with (the punchline's second face, or the base). */
  variant: CaptionStyle;
  /** Index into the caption's own word list, for timings. */
  wordIndex: number;
  start: number;
  end: number;
};

/** Something to paint: a word, a letter or a bilingual line, with its transform already resolved. */
type Glyph = {
  text: string;
  x: number;
  y: number;
  font: string;
  size: number;
  matrix: DOMMatrix;
  alpha: number;
  /** Blur radius in canvas pixels (0 = sharp). */
  blur: number;
  color: string;
  /** Fill with the style's text → accent gradient instead of `color`. */
  gradient?: boolean;
  /** Outlined letters only, not filled yet (`emphasis: "fill"`). */
  hollow?: boolean;
  /** Second colour painted over the left part of the word (karaoke, marker, fill). */
  over?: { color: string; from: number; to: number };
};

/** One word as it sits in the on-screen arrangement, before slots are measured. */
type RowItem = { text: string; keyword: boolean; variant: CaptionStyle; index: number };

/** Apply a text case to one word without touching the rest of the style. */
function caseAs(textCase: TextCase, text: string): string {
  return applyCase({ textCase }, text);
}

/** The style the punchline word(s) are drawn with — the lockup's second face. */
function keywordVariant(style: CaptionStyle): CaptionStyle {
  return { ...style, fontFamily: style.keywordFontFamily, weight: style.keywordWeight, textCase: style.keywordCase };
}

/** The caption's words, always current even after the text was edited. */
function captionWords(caption: Caption): string[] {
  const text = caption.text.trim();
  if (!text) return [];
  const fromWords = caption.words.map((w) => w.text).join(" ").trim();
  return caption.words.length && fromWords === text ? caption.words.map((w) => w.text) : text.split(/\s+/).filter(Boolean);
}

/**
 * Rows for a non-block layout: "stack" gives every word its own row, "lockup"
 * puts the words before the punchline on one row, the punchline word(s) on the
 * next, and anything after them on a third. Reading order is preserved whatever
 * the punchline's position in the line, so a middle punchline never jumps to the
 * bottom. Empty rows are dropped, so the usual trailing punchline still gives
 * the familiar base / punchline pair.
 */
function punchRows(style: CaptionStyle, words: string[], punch: Set<number>, punchStyle: CaptionStyle): RowItem[][] {
  if (!words.length) return [];
  const item = (text: string, index: number): RowItem => {
    const keyword = punch.has(index);
    return { text: caseAs(keyword ? style.keywordCase : style.textCase, text), keyword, variant: keyword ? punchStyle : style, index };
  };
  if (style.layout === "stack") return words.map((text, index) => [item(text, index)]);
  if (!punch.size) return [words.map((text, index) => item(text, index))];
  const marked = words.map((_, index) => index).filter((index) => punch.has(index));
  const first = marked[0];
  const last = marked[marked.length - 1];
  const rows: RowItem[][] = [];
  const slice = (from: number, to: number) => words.slice(from, to).map((text, i) => item(text, from + i));
  const before = slice(0, first);
  const hero = slice(first, last + 1);
  const after = slice(last + 1, words.length);
  if (before.length) rows.push(before);
  if (hero.length) rows.push(hero);
  if (after.length) rows.push(after);
  return rows;
}

/**
 * Draw `caption` onto a `width`×`height` frame at time `t` (seconds, on the
 * same timeline as the caption). The caller clears or paints the frame first.
 */
export function drawCaption(
  ctx: Ctx,
  caption: Caption,
  width: number,
  height: number,
  style: CaptionStyle,
  t: number,
  opts: DrawOptions = {},
) {
  const still = opts.still === true;
  const widths = new Map<string, number>();
  let measuredFont = "";
  const measure = (text: string, font: string) => {
    const key = `${font}\n${text}`;
    let w = widths.get(key);
    if (w === undefined) {
      if (font !== measuredFont) {
        ctx.font = font;
        measuredFont = font;
      }
      w = ctx.measureText(text).width;
      widths.set(key, w);
    }
    return w;
  };

  // Same line-breaking and fit-to-width logic as the hit box in the preview.
  const layout = layoutCaption(style, caption, width, height, measure);
  const layoutWords = layout.lines.map((line) => line.split(/\s+/).filter(Boolean));
  const flat = layoutWords.flat();
  // The accent target is a preset decision: "spoken" marks the word being said,
  // "keyword" marks the caption's punchline instead.
  const emphasis = style.emphasisTarget === "spoken" ? style.emphasis : "none";
  const speakers = style.speakerColors ? tokenSpeakers(caption, flat.length) : null;
  // Weight shift: every word gets a slot as wide as its bold look, so nothing
  // shifts sideways when a word turns bold.
  const slotStyle = emphasis === "weight" ? { ...style, weight: Math.max(style.weight, EMPHASIS_WEIGHT) } : style;
  const tiles = style.treatment === "tiles";
  const punchStyle = keywordVariant(style);

  const sourceWords = style.layout === "block" ? flat : captionWords(caption);
  const punch =
    style.emphasisTarget === "keyword" || style.layout !== "block"
      ? punchlineIndices(sourceWords, caption.punchlineWordIndices, style.layout === "lockup")
      : new Set<number>();

  // On-screen rows: block wraps normally; lockup splits at the punchline word(s);
  // stack gives every word its own row.
  let flatIndex = 0;
  const itemRows: RowItem[][] =
    style.layout === "block"
      ? layoutWords.map((texts) =>
          texts.map((text) => {
            const index = flatIndex++;
            const keyword = punch.has(index);
            return { text: keyword ? caseAs(style.keywordCase, text) : text, keyword, variant: keyword ? punchStyle : style, index };
          }),
        )
      : punchRows(style, sourceWords, punch, punchStyle);

  /** Word slots on every row at base font size `em`. */
  const arrange = (em: number) => {
    const gap = measure(" ", cssFont(style, em)) + (tiles ? em * 0.45 : 0);
    const rows = itemRows.map((items) => {
      const slots = items.map((item) => {
        const size = item.keyword ? Math.max(8, Math.round(em * style.keywordScale)) : em;
        const measureStyle = item.keyword ? item.variant : slotStyle;
        return { ...item, size, w: measure(item.text, cssFont(measureStyle, size)) };
      });
      const lineWidth = slots.reduce((sum, slot) => sum + slot.w, 0) + gap * Math.max(0, slots.length - 1);
      return { slots, lineWidth, rtl: isRtl(items.map((item) => item.text).join(" ")) };
    });
    return { em, gap, rows, widest: rows.reduce((m, r) => Math.max(m, r.lineWidth), 0) };
  };
  // Bigger punchlines and spaced-out tiles can overrun the width: shrink to fit.
  const maxWidth = width * CAPTION_MAX_WIDTH;
  let arranged = arrange(layout.fontSize);
  if (arranged.widest > maxWidth) {
    arranged = arrange(Math.max(8, Math.floor((layout.fontSize * maxWidth) / arranged.widest)));
  }
  const { em, gap, rows, widest } = arranged;
  const shrink = em / layout.fontSize;

  // Each row is as tall as its tallest word, so a big punchline line never
  // collides with the base line.
  const rowHeights = rows.map((row) => Math.round(Math.max(...row.slots.map((slot) => slot.size)) * 1.3));
  const padX = Math.round(em * 0.5);
  const padY = Math.round(em * 0.3);
  const sub = layout.sub ? { size: Math.max(8, Math.round(layout.sub.fontSize * shrink)), lines: layout.sub.lines } : null;
  const subLineHeight = sub ? Math.round(sub.size * 1.3) : 0;
  const mainHeight = rowHeights.reduce((sum, h) => sum + h, 0);
  const blockHeight = mainHeight + subLineHeight * (sub?.lines.length ?? 0);
  const top = blockTop(style, height, blockHeight);
  const blockLeftPx = blockLeft(style, width, widest);
  // Each row is anchored to the block: left/right rows line up with the block
  // edge, centred rows centre on it (which is the frame centre when centred).
  const rowLeft = (lineWidth: number) =>
    style.align === "left"
      ? blockLeftPx
      : style.align === "right"
        ? blockLeftPx + widest - lineWidth
        : blockLeftPx + (widest - lineWidth) / 2;
  const cx = blockLeftPx + widest / 2;
  const cy = top + blockHeight / 2;

  // Place every word on its row (right-to-left rows run from the right edge).
  const tokens: Token[] = [];
  let rowTop = top;
  rows.forEach((row, i) => {
    const rowHeight = rowHeights[i];
    const left = rowLeft(row.lineWidth);
    const y = rowTop + rowHeight / 2;
    rowTop += rowHeight;
    let before = 0;
    for (const slot of row.slots) {
      const slotX = row.rtl ? left + row.lineWidth - before - slot.w : left + before;
      before += slot.w + gap;
      tokens.push({
        text: slot.text,
        slotX,
        slotW: slot.w,
        x: slotX,
        w: slot.w,
        y,
        line: i,
        rtl: row.rtl,
        size: slot.size,
        font: "",
        keyword: slot.keyword,
        variant: slot.variant,
        wordIndex: slot.index,
        start: 0,
        end: 0,
      });
    }
  });
  const timings = tokenTimings(caption, sourceWords);
  tokens.forEach((tok) => {
    const timing = timings[tok.wordIndex] ?? timings[timings.length - 1];
    tok.start = timing?.start ?? caption.start;
    tok.end = timing?.end ?? caption.end;
  });
  const active = activeToken(timings, t);
  const age = t - caption.start;

  // Fonts now that the spoken word is known: weight shift bolds just that one.
  tokens.forEach((tok, k) => {
    const bold = emphasis === "weight" && k === active;
    tok.font = cssFont(bold ? slotStyle : tok.variant, tok.size);
    tok.w = measure(tok.text, tok.font);
    tok.x = tok.slotX + (tok.slotW - tok.w) / 2;
  });

  // Shadows and filters ignore the transform, so scale them by the caller's
  // base transform (the preview draws at devicePixelRatio).
  const base = ctx.getTransform();
  const pxScale = Math.hypot(base.a, base.b) || 1;

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // Whole-caption transform: free placement, entrance (when animating the
  // caption as one) and the idle loop.
  const blockEnter = style.animateBy === "caption" && !still ? enterPose(style.animation, age / ENTER_SECONDS.caption) : REST;
  ctx.translate(style.offsetX * width, style.offsetY * height);
  applyPose(ctx, blockEnter, cx, cy, em);
  if (!still) applyPose(ctx, loopBlockPose(style.loop, age), cx, cy, em);

  // Background box behind the whole block. When words arrive one by one the
  // box is already there, fading in quickly as the caption starts.
  if (style.treatment === "box") {
    ctx.save();
    if (style.animateBy !== "caption" && !still) ctx.globalAlpha *= clamp01(age / 0.15);
    ctx.fillStyle = withAlpha(style.boxColor, style.boxOpacity);
    roundedRect(ctx, rowLeft(widest) - padX, top - padY, widest + padX * 2, blockHeight + padY * 2, em * 0.35);
    ctx.fill();
    ctx.restore();
  }

  const onHighlight = contrastText(style.highlightColor);
  const perUnitEntrance = style.animateBy !== "caption" && !still;
  const splitLetters = style.animateBy === "letter" || style.loop === "wave";
  const wave = style.loop === "wave" && !still;
  const glyphs: Glyph[] = [];
  let letterIndex = 0;
  const glyph = (text: string, x: number, y: number, tok: Pick<Token, "font" | "size">, extra: Partial<Glyph>): Glyph => ({
    text,
    x,
    y,
    font: tok.font,
    size: tok.size,
    matrix: ctx.getTransform(),
    alpha: ctx.globalAlpha,
    blur: 0,
    color: style.textColor,
    ...extra,
  });

  tokens.forEach((tok, k) => {
    const letters = splitLetters && canSplitLetters(tok.text) ? splitGraphemes(tok.text) : null;
    const firstLetter = letterIndex;
    letterIndex += splitLetters ? splitGraphemes(tok.text).length : 1;
    // Words not yet spoken stay hidden when they animate in one by one.
    if (perUnitEntrance && t < tok.start) return;

    const tcx = tok.x + tok.w / 2;
    const wordEnter = style.animateBy === "word" && !still ? enterPose(style.animation, (t - tok.start) / ENTER_SECONDS.word) : REST;
    ctx.save();
    applyPose(ctx, wordEnter, tcx, tok.y, em);
    applyPose(ctx, wordMotionFor(style, tokens, k, active, t, still), tcx, tok.y, em);
    if (tiles) {
      // Each word on its own slightly tilted tile, alternating like stickers.
      applyPose(ctx, { ...REST, rotate: k % 2 ? 0.035 : -0.035 }, tcx, tok.y, em);
      ctx.save();
      ctx.fillStyle = withAlpha(style.boxColor, style.boxOpacity);
      roundedRect(ctx, tok.x - tok.size * 0.2, tok.y - tok.size * 0.6, tok.w + tok.size * 0.4, tok.size * 1.12, tok.size * 0.22);
      ctx.fill();
      ctx.restore();
    }
    if (style.dimUpcoming && k > active) ctx.globalAlpha *= 0.38;

    drawDecoration(ctx, style, emphasis, tokens, k, active, t, still, em);

    // Base colour: the speaker's, the accent for a punchline word, or the base.
    let color = speakers ? speakerColor(style, speakers[k]) : tok.variant.textColor;
    if (tok.keyword) color = style.highlightColor;
    let over: Glyph["over"];
    let hollow = false;
    if (emphasis === "color" && k === active) color = style.highlightColor;
    if (emphasis === "box" && k === active) color = onHighlight;
    if ((emphasis === "sweep" || emphasis === "marker") && k <= active) {
      const fill = emphasis === "sweep" ? style.highlightColor : onHighlight;
      const p = k < active || still ? 1 : sweepProgress(emphasis, tok, t);
      if (p >= 1) color = fill;
      else if (p > 0) over = sweepOver(tok, fill, p);
    }
    if (emphasis === "fill" && k >= active) {
      // Outlined until spoken; the spoken word floods solid from its start.
      const p = k > active ? 0 : still ? 1 : sweepProgress(emphasis, tok, t);
      if (p < 1) {
        hollow = true;
        if (p > 0) over = sweepOver(tok, color, p);
      }
    }
    // A punchline word may fill with the text → accent gradient (the lockup look).
    const gradient = (style.gradient && color === style.textColor && !over) || (tok.keyword && style.keywordGradient && !over);
    const blurEm = blockEnter.blur + wordEnter.blur;
    const blur = (b: number) => b * em * pxScale;

    if (!letters) {
      // Scripts that can't be split (Telugu, Arabic, …) move as whole words.
      if (wave) ctx.translate(0, waveOffset(age, firstLetter) * em);
      glyphs.push(glyph(tok.text, tok.x, tok.y, tok, { color, over, hollow, gradient, blur: blur(blurEm) }));
      ctx.restore();
      return;
    }

    const stagger = letterStagger(tok.end - tok.start, letters.length);
    let prefix = "";
    letters.forEach((letter, j) => {
      const lx = tok.x + (prefix ? measure(prefix, tok.font) : 0);
      prefix += letter;
      const letterStart = tok.start + j * stagger;
      if (perUnitEntrance && style.animateBy === "letter" && t < letterStart) return;
      const letterEnter =
        style.animateBy === "letter" && !still ? enterPose(style.animation, (t - letterStart) / ENTER_SECONDS.letter) : REST;
      ctx.save();
      applyPose(ctx, letterEnter, lx + measure(letter, tok.font) / 2, tok.y, em);
      if (wave) ctx.translate(0, waveOffset(age, firstLetter + j) * em);
      glyphs.push(glyph(letter, lx, tok.y, tok, { color, over, hollow, gradient, blur: blur(blurEm + letterEnter.blur) }));
      ctx.restore();
    });
    ctx.restore();
  });

  // Bilingual: the other script, smaller, under the caption. It arrives with
  // the caption and doesn't follow per-word effects.
  if (sub) {
    const subFont = cssFont({ ...style, weight: Math.min(style.weight, 600) }, sub.size);
    const color = speakers ? speakerColor(style, speakers[0] ?? 0) : style.textColor;
    ctx.save();
    ctx.globalAlpha *= 0.9 * (perUnitEntrance ? clamp01(age / 0.2) : 1);
    sub.lines.forEach((line, i) => {
      const w = measure(line, subFont);
      const y = top + mainHeight + i * subLineHeight + subLineHeight / 2;
      glyphs.push(glyph(line, rowLeft(w), y, { font: subFont, size: sub.size }, { color, blur: blockEnter.blur * em * pxScale }));
    });
    ctx.restore();
  }

  paintGlyphs(ctx, glyphs, style, em, pxScale, age, still, { left: blockLeftPx, width: widest, top, height: blockHeight });
  ctx.restore();
}

/** Clip range for a colour that has crossed `p` of the word, from its reading start. */
function sweepOver(tok: Token, color: string, p: number): NonNullable<Glyph["over"]> {
  return tok.rtl
    ? { color, from: tok.x + tok.w * (1 - p), to: tok.x + tok.w }
    : { color, from: tok.x, to: tok.x + tok.w * p };
}

/** How far the karaoke fill or marker has crossed the word (0–1). */
function sweepProgress(emphasis: CaptionEmphasis, tok: Token, t: number): number {
  const dur = tok.end - tok.start;
  // Karaoke follows the word's own length; the marker swipes in briskly.
  if (emphasis === "sweep") return clamp01((t - tok.start) / Math.max(0.12, dur));
  return easeOutCubic(clamp01((t - tok.start) / Math.min(0.5, Math.max(0.15, dur))));
}

/** Spoken-word motion for word `k`, easing back out after the next word takes over. */
function wordMotionFor(style: CaptionStyle, tokens: Token[], k: number, active: number, t: number, still: boolean): Pose {
  if (style.wordMotion === "none" || active < 0 || k > active) return REST;
  if (k === active) return motionPose(style.wordMotion, still ? Infinity : t - tokens[k].start, null);
  if (still) return REST;
  return motionPose(style.wordMotion, t - tokens[k].start, t - tokens[k + 1].start);
}

/** Box, marker or underline behind word `k`, drawn in that word's (already animated) space. */
function drawDecoration(
  ctx: Ctx,
  style: CaptionStyle,
  emphasis: CaptionEmphasis,
  tokens: Token[],
  k: number,
  active: number,
  t: number,
  still: boolean,
  em: number,
) {
  const tok = tokens[k];
  const color = style.highlightColor;

  if (emphasis === "marker" && k <= active) {
    const p = k < active || still ? 1 : sweepProgress(emphasis, tok, t);
    if (p <= 0) return;
    const w = (tok.w + em * 0.16) * p;
    const x = tok.rtl ? tok.x + tok.w + em * 0.08 - w : tok.x - em * 0.08;
    ctx.save();
    ctx.fillStyle = withAlpha(color, 0.92);
    // A slight tilt and uneven ends read as a hand-drawn highlighter stroke.
    ctx.translate(x, tok.y + em * 0.1);
    ctx.rotate(-0.012);
    roundedRect(ctx, 0, -em * 0.3, w, em * 0.62, em * 0.14);
    ctx.fill();
    ctx.restore();
    return;
  }

  if ((emphasis !== "box" && emphasis !== "underline") || k !== active) return;

  // Glide from the previous word when it sits on the same line; otherwise pop in.
  const prev = k > 0 && tokens[k - 1].line === tok.line ? tokens[k - 1] : null;
  const since = still ? Infinity : t - tok.start;
  const g = !prev || still ? 1 : easeOutCubic(clamp01(since / 0.14));
  const x = prev ? prev.x + (tok.x - prev.x) * g : tok.x;
  const w = prev ? prev.w + (tok.w - prev.w) * g : tok.w;
  const grow = prev || still ? 1 : Math.max(0.001, easeOutBack(clamp01(since / 0.16)));

  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(x + w / 2, tok.y);
  if (grow !== 1) ctx.scale(grow, grow);
  if (emphasis === "box") {
    const padX = em * 0.2;
    roundedRect(ctx, -w / 2 - padX, -em * 0.6, w + padX * 2, em * 1.12, em * 0.22);
  } else {
    roundedRect(ctx, -w / 2, em * 0.48, w, em * 0.1, em * 0.05);
  }
  ctx.fill();
  ctx.restore();
}

/**
 * Paint the glyphs in layers so neighbours never cover each other's edges:
 * outlines and shadows for every glyph first, then all the fills on top, then
 * light effects. A unit-by-unit draw would let one letter's outline cut into
 * the letter before it.
 */
function paintGlyphs(
  ctx: Ctx,
  glyphs: Glyph[],
  style: CaptionStyle,
  em: number,
  pxScale: number,
  age: number,
  still: boolean,
  block: { left: number; width: number; top: number; height: number },
) {
  const canFilter = "filter" in ctx;
  const shadow =
    style.treatment === "shadow"
      ? { color: "rgba(0, 0, 0, 0.65)", blur: em * 0.35, offsetX: 0, offsetY: Math.round(em * 0.08) }
      : style.treatment === "glow"
        ? { color: style.highlightColor, blur: em * 0.55, offsetX: 0, offsetY: 0 }
        : style.treatment === "comic"
          ? // A hard, unblurred offset copy, like printed comic lettering.
            { color: "#000000", blur: 0, offsetX: Math.round(em * 0.07), offsetY: Math.round(em * 0.09) }
          : null;
  const hollowWidth = (g: Glyph) => Math.max(1.5, g.size * 0.05);
  // Without an outline the shadow layer is itself a fill, so a faded glyph
  // would be painted twice. Split its opacity so the result matches one paint.
  const doubled = !!shadow && !style.outline;
  const alphaFor = (a: number) => (doubled && a < 1 ? 1 - Math.sqrt(1 - a) : a);

  const place = (g: Glyph) => {
    ctx.setTransform(g.matrix);
    ctx.font = g.font;
    ctx.globalAlpha = alphaFor(g.alpha);
    if (canFilter) ctx.filter = g.blur > 0.3 ? `blur(${g.blur.toFixed(2)}px)` : "none";
  };

  // 1. Outlines and shadows.
  if (style.outline || shadow) {
    ctx.save();
    if (shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur * pxScale;
      ctx.shadowOffsetX = shadow.offsetX * pxScale;
      ctx.shadowOffsetY = shadow.offsetY * pxScale;
    }
    if (style.outline) {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, em * 0.14);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    }
    for (const g of glyphs) {
      place(g);
      if (style.outline) ctx.strokeText(g.text, g.x, g.y);
      else if (g.hollow) {
        ctx.strokeStyle = g.color;
        ctx.lineWidth = hollowWidth(g);
        ctx.strokeText(g.text, g.x, g.y);
      } else {
        ctx.fillStyle = g.color;
        ctx.fillText(g.text, g.x, g.y);
      }
    }
    ctx.restore();
  }

  // 2. Glitch: offset red and cyan copies peek out during a burst.
  const glitch = style.loop === "glitch" && !still ? glitchAmount(age) : 0;
  if (glitch !== 0) {
    const split = (Math.abs(glitch) * 0.6 + 0.04) * em;
    ctx.save();
    for (const [color, dx] of [
      ["#ff2e63", -split],
      ["#08d9d6", split],
    ] as const) {
      ctx.fillStyle = color;
      for (const g of glyphs) {
        if (g.hollow) continue;
        place(g);
        ctx.globalAlpha = g.alpha * 0.75;
        ctx.fillText(g.text, g.x + dx, g.y);
      }
    }
    ctx.restore();
  }

  // 3. Fills, with the karaoke / marker / fill colour clipped over the spoken
  // part. Hollow words are only outlined, in their colour.
  ctx.save();
  ctx.lineJoin = "round";
  for (const g of glyphs) {
    place(g);
    if (g.hollow) {
      ctx.strokeStyle = g.color;
      ctx.lineWidth = hollowWidth(g);
      ctx.strokeText(g.text, g.x, g.y);
    } else {
      ctx.fillStyle = g.gradient ? textGradient(ctx, style, g) : g.color;
      ctx.fillText(g.text, g.x, g.y);
    }
    if (g.over) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.over.from, g.y - g.size, g.over.to - g.over.from, g.size * 2);
      ctx.clip();
      ctx.fillStyle = g.over.color;
      ctx.fillText(g.text, g.x, g.y);
      ctx.restore();
    }
  }
  ctx.restore();

  // 4. Shine: a band of light sweeps across the text now and then.
  const shine = style.loop === "shine" && !still ? shinePosition(age) : null;
  if (shine !== null) {
    const band = Math.max(em * 1.2, block.width * 0.18);
    const centre = block.left - band + shine * (block.width + band * 2);
    ctx.save();
    for (const g of glyphs) {
      if (g.hollow) continue;
      place(g);
      const gradient = ctx.createLinearGradient(centre - band, block.top, centre + band, block.top + block.height * 0.35);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
      gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.85)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.globalAlpha = g.alpha;
      ctx.fillText(g.text, g.x, g.y);
    }
    ctx.restore();
  }
}

/** Top-to-bottom text → accent gradient across one line of glyphs. */
function textGradient(ctx: Ctx, style: CaptionStyle, g: Glyph): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, g.y - g.size * 0.42, 0, g.y + g.size * 0.42);
  gradient.addColorStop(0, style.textColor);
  gradient.addColorStop(1, style.highlightColor);
  return gradient;
}
