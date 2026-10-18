"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { CAPTION_FONT_STACK, findCaptionAt, spokenWordAt } from "@/lib/client/caption-renderer";
import type { Caption } from "@/lib/types";

type Props = {
  src: string;
  captions: Caption[];
  /** BCP-47 language of the captions, if known. */
  language?: string;
  highlightWords: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
};

/**
 * Video with captions drawn over it, following playback frame by frame.
 * The overlay matches the burned-in export. "Fullscreen with captions" keeps the
 * overlay; the browser's own fullscreen button shows a native caption track instead.
 */
export function CaptionPlayer({ src, captions, language, highlightWords, videoRef }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<TextTrack | null>(null);
  const [pos, setPos] = useState({ cue: -1, word: -1 });

  // Follow playback. Re-render only when the visible cue or spoken word changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const update = () => {
      const t = video.currentTime;
      const cue = findCaptionAt(captions, t);
      const word = highlightWords && cue >= 0 ? spokenWordAt(captions[cue], t) : -1;
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
    const events = ["play", "seeked", "seeking", "loadedmetadata", "timeupdate"] as const;
    video.addEventListener("play", start);
    for (const e of events.slice(1)) video.addEventListener(e, update);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", start);
      for (const e of events.slice(1)) video.removeEventListener(e, update);
    };
  }, [videoRef, src, captions, highlightWords]);

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
  const canHighlight = !!cue && pos.word >= 0 && tokens.flat().length === cue.words.length;
  // Index of each line's first word within the cue.
  const lineStarts = tokens.map((_, i) => tokens.slice(0, i).reduce((n, t) => n + t.length, 0));

  const fullscreen = () => {
    const el = wrapperRef.current;
    if (el?.requestFullscreen) void el.requestFullscreen();
    else void videoRef.current?.requestFullscreen?.();
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrapperRef}
        className="@container relative flex items-center justify-center overflow-hidden rounded bg-black [&:fullscreen]:rounded-none"
      >
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          className="max-h-[70vh] w-full [:fullscreen>&]:h-full [:fullscreen>&]:max-h-full"
        />
        {cue && (
          <div
            className="pointer-events-none absolute inset-x-0 flex flex-col items-center px-[6%] text-center"
            style={{ bottom: "max(12%, 3.25rem)" }}
            data-testid="overlay"
            lang={language}
          >
            {lines.map((line, i) => {
              const start = lineStarts[i];
              return (
                <span
                  key={i}
                  className="bg-black/60 px-[0.4em] leading-[1.3] font-semibold text-white"
                  style={{ fontFamily: CAPTION_FONT_STACK, fontSize: "clamp(14px, 4cqw, 44px)" }}
                >
                  {canHighlight
                    ? tokens[i].map((tok, k) => (
                        <span key={k} className={start + k === pos.word ? "text-amber-300" : undefined}>
                          {k > 0 ? " " : ""}
                          {tok}
                        </span>
                      ))
                    : line}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <button type="button" onClick={fullscreen} className="self-start text-sm underline">
        Fullscreen with captions
      </button>
    </div>
  );
}
