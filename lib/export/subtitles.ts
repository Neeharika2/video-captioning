/** SRT and WebVTT writers. Times are seconds on the video timeline. */
import type { Caption } from "../types";

/** "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" (VTT). */
export function formatTimestamp(seconds: number, separator: "," | "."): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = (totalMs - ms) / 1000;
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${String(ms).padStart(3, "0")}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function cueText(c: Caption) {
  // Blank lines would end the cue early in both formats.
  const lines = c.lines?.length ? c.lines : [c.text];
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function sorted(captions: Caption[]) {
  return captions.filter((c) => c.text.trim() && c.end > c.start).sort((a, b) => a.start - b.start);
}

export function toSrt(captions: Caption[]): string {
  return sorted(captions)
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.start, ",")} --> ${formatTimestamp(c.end, ",")}\n${cueText(c)}\n`)
    .join("\n");
}

export function toVtt(captions: Caption[]): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cues = sorted(captions).map(
    (c) => `${formatTimestamp(c.start, ".")} --> ${formatTimestamp(c.end, ".")}\n${escape(cueText(c))}\n`,
  );
  return `WEBVTT\n\n${cues.join("\n")}`;
}
