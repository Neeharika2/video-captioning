"use client";

import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import type { Caption } from "@/lib/types";

/** Smallest gap kept between neighbouring cues (seconds); matches group-words. */
const GAP = 0.04;
/** Shortest a cue may become (seconds). */
const MIN_DUR = 0.2;

type Mode = "move" | "start" | "end";
type Drag = {
  id: string;
  mode: Mode;
  /** Pointer x at the start of the drag. */
  x0: number;
  start0: number;
  end0: number;
  /** Neighbours at the start of the drag: moving stays within [lo, hi]. */
  lo: number;
  hi: number;
};

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  captions: Caption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Commit a new time range for a cue while dragging. */
  onRetime: (id: string, start: number, end: number) => void;
  /** Restore a cue's original timing. */
  onReset: (id: string) => void;
};

/**
 * Caption timeline. Segments are positioned by time; click one to select it,
 * drag its body to slide it, or drag an edge to trim its start/end. The playhead
 * and progress are written straight to the DOM (no re-render per frame).
 */
export function Timeline({ videoRef, captions, selectedId, onSelect, onRetime, onReset }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const retimeRef = useRef(onRetime);
  useEffect(() => {
    retimeRef.current = onRetime;
  }, [onRetime]);
  const [duration, setDuration] = useState(0);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  const fallback = captions.length ? captions[captions.length - 1].end : 0;
  const total = duration || fallback;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const render = () => {
      const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : total;
      const p = d ? Math.min(1, Math.max(0, video.currentTime / d)) : 0;
      if (fillRef.current) fillRef.current.style.width = `${p * 100}%`;
      if (headRef.current) headRef.current.style.left = `${p * 100}%`;
      if (timeRef.current) timeRef.current.textContent = `${clock(video.currentTime)} / ${clock(d)}`;
    };
    const loop = () => {
      render();
      if (!video.paused && !video.ended) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onMeta = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
      render();
    };
    render();
    video.addEventListener("play", start);
    video.addEventListener("pause", render);
    for (const e of ["timeupdate", "seeked", "seeking", "loadedmetadata", "durationchange"] as const) {
      video.addEventListener(e, onMeta);
    }
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", start);
      video.removeEventListener("pause", render);
      for (const e of ["timeupdate", "seeked", "seeking", "loadedmetadata", "durationchange"] as const) {
        video.removeEventListener(e, onMeta);
      }
    };
  }, [videoRef, total]);

  // Drag handling, on window so the pointer can leave the strip.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !width || !total) return;
      const ds = ((e.clientX - d.x0) / width) * total;
      if (d.mode === "move") {
        const dur = d.end0 - d.start0;
        const start = clamp(d.start0 + ds, d.lo, Math.max(d.lo, d.hi - dur));
        retimeRef.current(d.id, round(start), round(start + dur));
      } else if (d.mode === "start") {
        const start = clamp(d.start0 + ds, d.lo, Math.max(d.lo, d.end0 - MIN_DUR));
        retimeRef.current(d.id, round(start), round(d.end0));
      } else {
        const end = clamp(d.end0 + ds, Math.min(d.hi, d.start0 + MIN_DUR), d.hi);
        retimeRef.current(d.id, round(d.start0), round(end));
      }
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
  }, [dragging, width, total]);

  const bounds = (index: number, c: Caption): { lo: number; hi: number } => ({
    lo: index > 0 ? captions[index - 1].end + GAP : 0,
    // The last cue may run to the end of the video; if the duration isn't known
    // yet, allow a generous margin so dragging still works.
    hi:
      index < captions.length - 1
        ? captions[index + 1].start - GAP
        : Math.max(total, c.end) + (duration > 0 ? 0 : 10),
  });

  const beginDrag = (e: ReactPointerEvent, c: Caption, mode: Mode) => {
    e.preventDefault();
    e.stopPropagation();
    const index = captions.findIndex((x) => x.id === c.id);
    if (index < 0) return;
    const { lo, hi } = bounds(index, c);
    dragRef.current = { id: c.id, mode, x0: e.clientX, start0: c.start, end0: c.end, lo, hi };
    onSelect(c.id);
    if (mode === "move") seek(c.start);
    setDragging(true);
  };

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const selected = selectedId ? captions.find((c) => c.id === selectedId) : undefined;

  const nudge = (delta: number) => {
    if (!selected) return;
    const index = captions.findIndex((c) => c.id === selected.id);
    const { lo, hi } = bounds(index, selected);
    const dur = selected.end - selected.start;
    const start = clamp(selected.start + delta, lo, Math.max(lo, hi - dur));
    onRetime(selected.id, round(start), round(start + dur));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Timeline</span>
        <span ref={timeRef} className="font-mono text-xs tabular-nums text-zinc-500">
          0:00 / 0:00
        </span>
      </div>

      <div
        ref={trackRef}
        onPointerDown={() => onSelect(null)}
        className="relative h-14 w-full touch-none overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 select-none dark:border-zinc-800 dark:bg-zinc-900/50"
        data-testid="timeline"
      >
        <div ref={fillRef} className="pointer-events-none absolute inset-y-0 left-0 w-0 bg-zinc-900/10 dark:bg-zinc-100/10" />

        {total > 0 &&
          captions.map((c) => {
            const isSelected = c.id === selectedId;
            const widthPct = Math.max(0.6, ((c.end - c.start) / total) * 100);
            return (
              <div
                key={c.id}
                className="absolute inset-y-1"
                style={{ left: `${(c.start / total) * 100}%`, width: `${widthPct}%` }}
              >
                <button
                  type="button"
                  onPointerDown={(e) => beginDrag(e, c, "move")}
                  title={`${clock(c.start)} → ${clock(c.end)} · drag to move`}
                  className={`h-full w-full cursor-grab overflow-hidden rounded border px-1 text-left text-[10px] leading-tight shadow-sm transition ${
                    isSelected
                      ? "border-amber-400 bg-amber-50 text-zinc-800 dark:border-amber-400 dark:bg-amber-500/15 dark:text-amber-50"
                      : "border-white/70 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  <span className="line-clamp-2">{c.lines?.join(" ") ?? c.text}</span>
                </button>
                {isSelected && (
                  <>
                    <button
                      type="button"
                      aria-label="Adjust caption start"
                      onPointerDown={(e) => beginDrag(e, c, "start")}
                      className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l bg-amber-400/90"
                    />
                    <button
                      type="button"
                      aria-label="Adjust caption end"
                      onPointerDown={(e) => beginDrag(e, c, "end")}
                      className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-amber-400/90"
                    />
                  </>
                )}
              </div>
            );
          })}

        <div ref={headRef} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-zinc-900 dark:bg-zinc-100" />
      </div>

      {selected ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500" data-testid="timeline-selected">
          <span className="font-mono tabular-nums">
            {timecode(selected.start)} → {timecode(selected.end)} · {(selected.end - selected.start).toFixed(2)}s
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => nudge(-0.1)}
              className="rounded px-2 py-0.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              ◀ 0.1s
            </button>
            <button
              type="button"
              onClick={() => nudge(0.1)}
              className="rounded px-2 py-0.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              0.1s ▶
            </button>
            <button
              type="button"
              onClick={() => onReset(selected.id)}
              className="rounded px-2 py-0.5 underline transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Reset
            </button>
          </span>
        </div>
      ) : (
        <p className="text-xs text-zinc-400">Click a segment to select it, then drag it to move, or drag an edge to trim.</p>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** `m:ss.cc` (hundredths), used for the selected-cue readout. */
function timecode(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00.00";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function clock(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
