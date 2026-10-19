"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ANIMATION_SECONDS,
  MAX_CAPTION_SCALE,
  MIN_CAPTION_SCALE,
  captionEnter,
  fontStack,
  fontSizeFor,
  styleForCaption,
  withAlpha,
  type CaptionPlacement,
  type CaptionPosition,
  type CaptionStyle,
} from "@/lib/caption-style";
import { layoutCaption } from "@/lib/caption-layout";
import { ensureCaptionFont } from "@/lib/client/caption-fonts";
import { findCaptionAt, spokenWordAt } from "@/lib/client/caption-renderer";
import type { Caption } from "@/lib/types";

/** Placeholder shown only when there are no captions on screen and the video is paused. */
const SAMPLE_TEXT = "Sample caption";

const HANDLES = ["nw", "ne", "sw", "se"] as const;
type Handle = (typeof HANDLES)[number];

let measureCtx: CanvasRenderingContext2D | null = null;

/** Measure text with the same font stack the canvas renderer uses. */
function measureCaptionText(text: string, font: string): number {
  if (typeof document === "undefined") return text.length * 10;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 10;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

type Props = {
  src: string;
  captions: Caption[];
  style: CaptionStyle;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Extra classes for the outer column (usually sizing from the workspace). */
  className?: string;
  /** Let the caption be dragged to place it, and show a sample when nothing is on screen. */
  interactive?: boolean;
  /**
   * New placement from dragging. `id` is the caption being moved, or `null`
   * when the default (no caption on screen) is being positioned.
   */
  onPlacement?: (id: string | null, placement: CaptionPlacement) => void;
  /** New font scale from dragging a corner. `null` = the default style/sample. */
  onScale?: (id: string | null, scale: number) => void;
  /** Use one caption's size for every caption. */
  onSyncSize?: (scale: number) => void;
  /** Use one caption's spot for every caption. */
  onSyncPlacement?: (placement: CaptionPlacement) => void;
};

/**
 * Video preview with captions drawn over it, following playback frame by frame.
 *
 * The stage is sized to the video's own aspect ratio (read from the file, not
 * assumed), so nothing is letterboxed and the overlay covers exactly the frame —
 * the same area the burned-in export draws on. Each caption can be dragged to
 * its own spot and resized from its corners; placement, size, line breaks and
 * the appearance animation all match the export.
 */
export function CaptionPlayer({
  src,
  captions,
  style,
  videoRef,
  className,
  interactive = false,
  onPlacement,
  onScale,
  onSyncSize,
  onSyncPlacement,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<TextTrack | null>(null);
  const dragRef = useRef<{
    id: string | null;
    position: CaptionPosition;
    x0: number;
    y0: number;
    ox: number;
    oy: number;
    w: number;
    h: number;
  } | null>(null);
  const resizeRef = useRef<{
    id: string | null;
    scale0: number;
    cx: number;
    cy: number;
    dist0: number;
  } | null>(null);
  const placementRef = useRef(onPlacement);
  const scaleRef = useRef(onScale);
  const [pos, setPos] = useState({ cue: -1, word: -1, age: Infinity, sample: false });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState(16 / 9);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  // Bumped when a webfont finishes loading, so the memoised layout re-measures.
  const [fontsReady, setFontsReady] = useState(0);
  const emphasize = style.emphasis === "highlight";

  useEffect(() => {
    placementRef.current = onPlacement;
  }, [onPlacement]);

  useEffect(() => {
    scaleRef.current = onScale;
  }, [onScale]);

  // Re-measure once a font arrives: canvas metrics change when the face swaps in.
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    const bump = () => setFontsReady((n) => n + 1);
    document.fonts.addEventListener("loadingdone", bump);
    void document.fonts.ready.then(bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, []);

  // Fetch the selected face as soon as it is chosen, rather than on first draw.
  useEffect(() => {
    void ensureCaptionFont(style.fontFamily, style.weight);
  }, [style.fontFamily, style.weight]);

  // Measure the available preview area so the stage can be fitted into it.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || window.innerWidth;
      const h = el.clientHeight || window.innerHeight * 0.75;
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, []);

  // Read the true pixel size once metadata is available (portrait, square, …).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const read = () => {
      if (video.videoWidth && video.videoHeight) setRatio(video.videoWidth / video.videoHeight);
    };
    read();
    video.addEventListener("loadedmetadata", read);
    video.addEventListener("resize", read);
    return () => {
      video.removeEventListener("loadedmetadata", read);
      video.removeEventListener("resize", read);
    };
  }, [videoRef, src]);

  // Follow playback. Re-render when the visible cue, spoken word, appearance
  // animation, or the on-screen sample changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const update = () => {
      const t = video.currentTime;
      const cue = findCaptionAt(captions, t);
      const word = emphasize && cue >= 0 ? spokenWordAt(captions[cue], t) : -1;
      // Animate only while playing: pausing or seeking shows the resting look
      // (and makes the caption easy to grab, drag and resize).
      const raw = cue >= 0 && !video.paused ? t - captions[cue].start : Infinity;
      const age = raw < ANIMATION_SECONDS ? raw : Infinity;
      // Only offer the placement sample before the first cue (or with no
      // captions at all) — never inside a gap, which would look like a real cue.
      const sample = video.paused && cue < 0 && (captions.length === 0 || t < captions[0].start);
      setPos((prev) =>
        prev.cue === cue && prev.word === word && prev.age === age && prev.sample === sample
          ? prev
          : { cue, word, age, sample },
      );
    };
    const loop = () => {
      update();
      if (!video.paused && !video.ended) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const events = ["seeked", "seeking", "loadedmetadata", "timeupdate"] as const;
    video.addEventListener("play", start);
    video.addEventListener("pause", update);
    for (const e of events) video.addEventListener(e, update);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", start);
      video.removeEventListener("pause", update);
      for (const e of events) video.removeEventListener(e, update);
    };
  }, [videoRef, src, captions, emphasize]);

  // Native caption track, shown only when the <video> itself is fullscreen
  // (the overlay can't follow it there).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!trackRef.current) trackRef.current = video.addTextTrack("captions", "Captions", "");
    const track = trackRef.current;
    track.mode = "hidden"; // cues are only readable when not "disabled"
    for (const cue of Array.from(track.cues ?? [])) track.removeCue(cue);
    for (const c of captions) {
      track.addCue(new VTTCue(c.start, c.end, (c.lines?.length ? c.lines : [c.text]).join("\n")));
    }

    const show = () => (track.mode = "showing");
    const hide = () => (track.mode = "hidden");
    const sync = () => (document.fullscreenElement === video ? show() : hide());
    document.addEventListener("fullscreenchange", sync);
    // iOS Safari fullscreen
    video.addEventListener("webkitbeginfullscreen", show);
    video.addEventListener("webkitendfullscreen", hide);
    sync();
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      video.removeEventListener("webkitbeginfullscreen", show);
      video.removeEventListener("webkitendfullscreen", hide);
    };
  }, [videoRef, captions]);

  // Drag to place the caption, on window so the pointer can leave the stage.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const change = placementRef.current;
      if (!d || !change) return;
      const stageW = Math.max(0, Math.min(box.w, box.h * ratio));
      const stageH = ratio > 0 ? stageW / ratio : 0;
      if (!stageW || !stageH) return;
      const next = clampOffsets(
        (e.clientX - d.x0) / stageW + d.ox,
        (e.clientY - d.y0) / stageH + d.oy,
        d.w,
        d.h,
        stageW,
        stageH,
        d.position,
      );
      change(d.id, { position: d.position, offsetX: round(next.x, 4), offsetY: round(next.y, 4) });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, box.w, box.h, ratio]);

  // Drag a corner to resize, scaling about the block's centre. Also on window
  // so the pointer can leave the stage without ending the gesture.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const d = resizeRef.current;
      const change = scaleRef.current;
      if (!d || !change) return;
      const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
      const next = clamp(d.scale0 * (dist / d.dist0), MIN_CAPTION_SCALE, MAX_CAPTION_SCALE);
      change(d.id, round(next, 4));
    };
    const onUp = () => {
      resizeRef.current = null;
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing]);

  const cue = pos.cue >= 0 ? captions[pos.cue] : undefined;
  const showGhost = !cue && interactive && pos.sample;
  // This cue's own placement and size, or the style's defaults.
  const effStyle = styleForCaption(style, cue?.placement, cue?.scale);

  // Fit the video's ratio into the measured area: width-bound in landscape,
  // height-bound in portrait. Either way the stage equals the frame exactly.
  const stageW = Math.max(0, Math.min(box.w, box.h * ratio));
  const stageH = ratio > 0 ? stageW / ratio : 0;

  // Same line-breaking as the burn-in. Memoised so playback frames don't re-measure.
  const layout = useMemo(() => {
    if (!cue || stageW <= 0 || stageH <= 0) return null;
    // `fontsReady` is read only to invalidate this cache when a face swaps in.
    void fontsReady;
    return layoutCaption(styleForCaption(style, cue.placement, cue.scale), cue, stageW, stageH, measureCaptionText);
  }, [cue, style, stageW, stageH, fontsReady]);

  const fontSize = layout ? layout.fontSize : stageW ? fontSizeFor(effStyle, stageW, stageH) : 16;
  const lines = layout ? layout.lines : showGhost ? [SAMPLE_TEXT] : [];
  const tokens = lines.map((line) => line.split(/\s+/).filter(Boolean));
  const canHighlight = emphasize && !!cue && pos.word >= 0 && tokens.flat().length === cue.words.length;
  // Index of each line's first word within the cue.
  const lineStarts = tokens.map((_, i) => tokens.slice(0, i).reduce((n, t) => n + t.length, 0));

  const margin = Math.round(stageH * 0.07);
  const alignItems =
    effStyle.position === "top" ? "flex-start" : effStyle.position === "middle" ? "center" : "flex-end";
  const enter = cue ? captionEnter(style.animation, pos.age) : { opacity: 1, scale: 1, shiftY: 0 };
  const blockStyle: CSSProperties = {
    position: "relative",
    maxWidth: "100%",
    fontFamily: fontStack(style.fontFamily),
    fontSize,
    fontWeight: style.weight,
    lineHeight: 1.3,
    textAlign: "center",
    textTransform: style.uppercase ? "uppercase" : undefined,
    color: style.textColor,
    transform: `translate(${effStyle.offsetX * stageW}px, ${effStyle.offsetY * stageH + enter.shiftY * stageH}px)${
      enter.scale !== 1 ? ` scale(${enter.scale})` : ""
    }`,
    transformOrigin: "center",
    opacity: enter.opacity,
    pointerEvents: interactive ? "auto" : "none",
  };
  if (interactive) {
    blockStyle.cursor = dragging ? "grabbing" : "grab";
    blockStyle.touchAction = "none";
  }
  if (style.treatment === "box") {
    blockStyle.background = withAlpha(style.boxColor, style.boxOpacity);
    blockStyle.padding = `${Math.round(fontSize * 0.3)}px ${Math.round(fontSize * 0.5)}px`;
    blockStyle.borderRadius = Math.round(fontSize * 0.35);
  } else if (style.treatment === "shadow") {
    blockStyle.textShadow = `0 ${Math.max(1, Math.round(fontSize * 0.08))}px ${Math.max(2, Math.round(fontSize * 0.35))}px rgba(0, 0, 0, 0.65)`;
  } else if (style.treatment === "glow") {
    blockStyle.textShadow = `0 0 ${Math.max(4, Math.round(fontSize * 0.55))}px ${style.highlightColor}`;
  }
  if (style.outline) {
    blockStyle.WebkitTextStrokeWidth = `${Math.max(1, fontSize * 0.06)}px`;
    blockStyle.WebkitTextStrokeColor = "rgba(0, 0, 0, 0.9)";
    blockStyle.paintOrder = "stroke";
  }
  if (showGhost) {
    blockStyle.outline = "1px dashed rgba(255, 255, 255, 0.55)";
    blockStyle.outlineOffset = 4;
  }

  const startDrag = (e: ReactPointerEvent) => {
    const el = blockRef.current;
    if (!onPlacement || !el) return;
    e.preventDefault();
    e.stopPropagation();
    const base = cue?.placement;
    dragRef.current = {
      id: cue?.id ?? null,
      position: base?.position ?? style.position,
      ox: base?.offsetX ?? style.offsetX,
      oy: base?.offsetY ?? style.offsetY,
      x0: e.clientX,
      y0: e.clientY,
      w: el.offsetWidth,
      h: el.offsetHeight,
    };
    setDragging(true);
  };

  const startResize = (e: ReactPointerEvent) => {
    const el = blockRef.current;
    if (!onScale || !el) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    resizeRef.current = {
      id: cue?.id ?? null,
      scale0: effStyle.scale,
      cx,
      cy,
      dist0: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)),
    };
    setResizing(true);
  };

  const fullscreen = () => {
    const el = stageRef.current;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el?.requestFullscreen?.();
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-3 ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Preview</span>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {interactive && cue && onSyncSize && (
            <button
              type="button"
              onClick={() => onSyncSize(effStyle.scale)}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
                <path
                  d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
              Sync size to all
            </button>
          )}
          {interactive && cue && onSyncPlacement && (
            <button
              type="button"
              onClick={() =>
                onSyncPlacement({
                  position: effStyle.position,
                  offsetX: effStyle.offsetX,
                  offsetY: effStyle.offsetY,
                })
              }
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path
                  d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Sync position to all
            </button>
          )}
          <button
            type="button"
            onClick={fullscreen}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <path
                d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Fullscreen
          </button>
        </div>
      </div>

      <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center [&:fullscreen]:bg-black">
        <div
          className="relative overflow-hidden rounded-lg bg-black shadow-sm [&:fullscreen]:rounded-none"
          style={stageW ? { width: stageW, height: stageH } : undefined}
        >
          <video ref={videoRef} src={src} controls playsInline className="h-full w-full" />
          {(cue || showGhost) && (
            <div
              className="pointer-events-none absolute inset-0 flex justify-center px-[6%]"
              style={{ alignItems, paddingTop: margin, paddingBottom: margin }}
              data-testid="overlay"
            >
              <div
                ref={blockRef}
                style={blockStyle}
                data-caption-block
                data-animation={style.animation}
                data-offset-x={round(effStyle.offsetX, 4)}
                data-offset-y={round(effStyle.offsetY, 4)}
                data-scale={round(effStyle.scale, 4)}
                onPointerDown={startDrag}
              >
                {showGhost && !resizing && (
                  <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] whitespace-nowrap text-white/80">
                    Drag to move · corners resize
                  </span>
                )}
                {resizing && (
                  <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] whitespace-nowrap text-white/80">
                    {Math.round(fontSize)} px
                  </span>
                )}
                {lines.map((line, i) => (
                  <span key={i} className="block">
                    {canHighlight
                      ? tokens[i].map((tok, k) => (
                          <span
                            key={k}
                            style={lineStarts[i] + k === pos.word ? { color: style.highlightColor } : undefined}
                          >
                            {k > 0 ? " " : ""}
                            {tok}
                          </span>
                        ))
                      : line}
                  </span>
                ))}
                {interactive &&
                  onScale &&
                  HANDLES.map((h) => (
                    <span
                      key={h}
                      data-resize-handle={h}
                      onPointerDown={startResize}
                      className="absolute h-2.5 w-2.5 rounded-sm border border-zinc-900/70 bg-white shadow-sm"
                      style={{
                        ...handlePosition(h),
                        cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
                        touchAction: "none",
                      }}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pin a resize handle to one corner of the block. */
function handlePosition(handle: Handle): CSSProperties {
  const offset = -5;
  return {
    left: handle === "nw" || handle === "sw" ? offset : undefined,
    right: handle === "ne" || handle === "se" ? offset : undefined,
    top: handle === "nw" || handle === "ne" ? offset : undefined,
    bottom: handle === "sw" || handle === "se" ? offset : undefined,
  };
}

/**
 * Keep the block inside the frame while dragging, given its offset from the
 * anchor. Mirrors the DOM layout (and canvas `blockTop`) so nothing escapes.
 */
function clampOffsets(
  dx: number,
  dy: number,
  blockW: number,
  blockH: number,
  stageW: number,
  stageH: number,
  position: CaptionPosition,
): { x: number; y: number } {
  const marginPx = Math.round(stageH * 0.07);
  const baseLeft = (stageW - blockW) / 2;
  const baseTop =
    position === "top" ? marginPx : position === "middle" ? (stageH - blockH) / 2 : stageH - marginPx - blockH;
  return {
    x: clamp(dx, -baseLeft / stageW, (stageW - blockW - baseLeft) / stageW),
    y: clamp(dy, -baseTop / stageH, (stageH - blockH - baseTop) / stageH),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
