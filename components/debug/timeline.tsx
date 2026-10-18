"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import type { Caption } from "@/lib/types";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  captions: Caption[];
};

/**
 * Caption timeline. Segments are positioned by time and seek on click; the
 * playhead and progress are updated straight on the DOM (no re-render per frame).
 */
export function Timeline({ videoRef, captions }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(0);

  const fallback = captions.length ? captions[captions.length - 1].end : 0;
  const total = duration || fallback;

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

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
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
        className="relative h-14 w-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50"
        data-testid="timeline"
      >
        <div ref={fillRef} className="pointer-events-none absolute inset-y-0 left-0 w-0 bg-zinc-900/10 dark:bg-zinc-100/10" />
        {total > 0 &&
          captions.map((c) => {
            const width = Math.max(0.5, ((c.end - c.start) / total) * 100);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => seek(c.start)}
                title={`${clock(c.start)} · ${c.lines?.join(" ") ?? c.text}`}
                className="absolute inset-y-1 overflow-hidden rounded border border-white/70 bg-white px-1 text-left text-[10px] leading-tight text-zinc-600 shadow-sm transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                style={{ left: `${(c.start / total) * 100}%`, width: `${width}%` }}
              >
                <span className="line-clamp-2">{c.lines?.join(" ") ?? c.text}</span>
              </button>
            );
          })}
        <div ref={headRef} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-zinc-900 dark:bg-zinc-100" />
      </div>
    </div>
  );
}

function clock(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
