"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ANIMATION_SECONDS,
  captionEnter,
  fontStack,
  fontSizeFor,
  styleForCaption,
  type CaptionPlacement,
  type CaptionPosition,
  type CaptionStyle,
} from "@/lib/caption-style";
import { findCaptionAt, spokenWordAt } from "@/lib/client/caption-renderer";
import type { Caption } from "@/lib/types";

/** Placeholder shown only when there are no captions on screen and the video is paused. */
const SAMPLE_TEXT = "Sample caption";

type Props = {
  src: string;
  captions: Caption[];
  /** BCP-47 language of the captions, if known. */
  language?: string;
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
};

/**
 * Video preview with captions drawn over it, following playback frame by frame.
 *
 * The stage is sized to the video's own aspect ratio (read from the file, not
 * assumed), so nothing is letterboxed and the overlay covers exactly the frame —
 * the same area the burned-in export draws on. Each caption can be dragged to
 * its own spot; placement and the appearance animation match the export.
 */
export function CaptionPlayer({
  src,
  captions,
  language,
  style,
  videoRef,
  className,
  interactive = false,
  onPlacement,
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
  const placementRef = useRef(onPlacement);
  const [pos, setPos] = useState({ cue: -1, word: -1, age: Infinity, sample: false });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState(16 / 9);
  const [dragging, setDragging] = useState(false);
  const emphasize = style.emphasis === "highlight";

  useEffect(() => {
    placementRef.current = onPlacement;
  }, [onPlacement]);

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
      // (and makes the caption easy to grab and drag).
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
    if (!trackRef.current) trackRef.current = video.addTextTrack("captions", "Captions", language ?? "");
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
  }, [videoRef, captions, language]);

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

  const cue = pos.cue >= 0 ? captions[pos.cue] : undefined;
  const lines = cue ? (cue.lines?.length ? cue.lines : [cue.text]) : [];
  const showGhost = !cue && interactive && pos.sample;
  // This cue's own placement, or the style's default.
  const effStyle = styleForCaption(style, cue?.placement);
  const tokens = lines.map((l) => l.split(/\s+/).filter(Boolean));
  const canHighlight = emphasize && !!cue && pos.word >= 0 && tokens.flat().length === cue.words.length;
  // Index of each line's first word within the cue.
  const lineStarts = tokens.map((_, i) => tokens.slice(0, i).reduce((n, t) => n + t.length, 0));

  // Fit the video's ratio into the measured area: width-bound in landscape,
  // height-bound in portrait. Either way the stage equals the frame exactly.
  const stageW = Math.max(0, Math.min(box.w, box.h * ratio));
  const stageH = ratio > 0 ? stageW / ratio : 0;
  const fontSize = stageW ? fontSizeFor(style, stageW, stageH) : 16;
  const margin = Math.round(stageH * 0.07);
  const alignItems =
    effStyle.position === "top" ? "flex-start" : effStyle.position === "middle" ? "center" : "flex-end";
  const enter = cue ? captionEnter(style.animation, pos.age) : { opacity: 1, scale: 1, shiftY: 0 };
  const blockStyle: CSSProperties = {
    fontFamily: fontStack(style.fontFamily),
    fontSize,
    fontWeight: style.weight,
    lineHeight: 1.3,
    textAlign: "center",
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
    blockStyle.background = `rgba(0, 0, 0, ${style.boxOpacity})`;
    blockStyle.padding = `${Math.round(fontSize * 0.3)}px ${Math.round(fontSize * 0.5)}px`;
    blockStyle.borderRadius = Math.round(fontSize * 0.35);
  } else if (style.treatment === "shadow") {
    blockStyle.textShadow = `0 ${Math.max(1, Math.round(fontSize * 0.08))}px ${Math.max(2, Math.round(fontSize * 0.35))}px rgba(0, 0, 0, 0.65)`;
  } else if (style.treatment === "outline") {
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

  const fullscreen = () => {
    const el = stageRef.current;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el?.requestFullscreen?.();
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-3 ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Preview</span>
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
              lang={language}
            >
              <div
                ref={blockRef}
                style={blockStyle}
                data-caption-block
                data-animation={style.animation}
                data-offset-x={round(effStyle.offsetX, 4)}
                data-offset-y={round(effStyle.offsetY, 4)}
                onPointerDown={startDrag}
              >
                {showGhost && (
                  <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] whitespace-nowrap text-white/80">
                    Drag to position
                  </span>
                )}
                {(showGhost ? [SAMPLE_TEXT] : lines).map((line, i) => (
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
