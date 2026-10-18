"use client";

import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fontStack, fontSizeFor, type CaptionStyle } from "@/lib/caption-style";
import { findCaptionAt, spokenWordAt } from "@/lib/client/caption-renderer";
import type { Caption } from "@/lib/types";

type Props = {
  src: string;
  captions: Caption[];
  /** BCP-47 language of the captions, if known. */
  language?: string;
  style: CaptionStyle;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Extra classes for the outer column (usually sizing from the workspace). */
  className?: string;
};

/**
 * Video preview with captions drawn over it, following playback frame by frame.
 *
 * The stage is sized to the video's own aspect ratio (read from the file, not
 * assumed), so nothing is letterboxed and the overlay covers exactly the frame —
 * the same area the burned-in export draws on.
 */
export function CaptionPlayer({ src, captions, language, style, videoRef, className }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<TextTrack | null>(null);
  const [pos, setPos] = useState({ cue: -1, word: -1 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState(16 / 9);
  const emphasize = style.emphasis === "highlight";

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

  // Follow playback. Re-render only when the visible cue or spoken word changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const update = () => {
      const t = video.currentTime;
      const cue = findCaptionAt(captions, t);
      const word = emphasize && cue >= 0 ? spokenWordAt(captions[cue], t) : -1;
      setPos((prev) => (prev.cue === cue && prev.word === word ? prev : { cue, word }));
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
    for (const e of events) video.addEventListener(e, update);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", start);
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

  const cue = pos.cue >= 0 ? captions[pos.cue] : undefined;
  const lines = cue ? (cue.lines?.length ? cue.lines : [cue.text]) : [];
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
  const alignItems = style.position === "top" ? "flex-start" : style.position === "middle" ? "center" : "flex-end";
  const blockStyle: CSSProperties = {
    fontFamily: fontStack(style.fontFamily),
    fontSize,
    fontWeight: style.weight,
    lineHeight: 1.3,
    textAlign: "center",
    color: style.textColor,
  };
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

      <div
        ref={stageRef}
        className="flex min-h-0 flex-1 items-center justify-center [&:fullscreen]:bg-black"
      >
        <div
          className="relative overflow-hidden rounded-lg bg-black shadow-sm [&:fullscreen]:rounded-none"
          style={stageW ? { width: stageW, height: stageH } : undefined}
        >
          <video ref={videoRef} src={src} controls playsInline className="h-full w-full" />
          {cue && (
            <div
              className="pointer-events-none absolute inset-0 flex justify-center px-[6%]"
              style={{ alignItems, paddingTop: margin, paddingBottom: margin }}
              data-testid="overlay"
              lang={language}
            >
              <div style={blockStyle}>
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
