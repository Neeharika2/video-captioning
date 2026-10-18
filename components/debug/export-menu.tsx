"use client";

import { useRef, useState } from "react";
import { toSrt, toVtt } from "@/lib/export/subtitles";
import {
  chooseSaveTarget,
  downloadBlob,
  downloadText,
  outputName,
  SaveCancelledError,
  type SaveTarget,
} from "@/lib/client/save-file";
import type { CaptionStyle } from "@/lib/caption-style";
import type { Caption } from "@/lib/types";

type Job =
  | { kind: "idle" }
  | { kind: "running"; label: string; progress: number }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

type Props = {
  file: File | null;
  captions: Caption[];
  /** Caption look applied to the burned-in video. */
  style: CaptionStyle;
  disabled?: boolean;
};

/** Top-toolbar Export menu: rendered MP4, .srt and .vtt. */
export function ExportMenu({ file, captions, style, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<Job>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const running = job.kind === "running";
  const unavailable = disabled || !file || captions.length === 0;
  const off = unavailable || running;

  const runJob = async (
    label: string,
    work: (signal: AbortSignal, onProgress: (p: number) => void) => Promise<string>,
  ) => {
    const abort = new AbortController();
    abortRef.current = abort;
    setJob({ kind: "running", label, progress: 0 });
    const started = performance.now();
    try {
      const message = await work(abort.signal, (progress) =>
        setJob((j) => (j.kind === "running" ? { ...j, progress } : j)),
      );
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      setJob({ kind: "done", message: `${message} (${secs} s)` });
    } catch (err) {
      if (abort.signal.aborted) setJob({ kind: "done", message: "Cancelled." });
      else setJob({ kind: "error", message: (err as Error).message });
    }
  };

  const burnIn = async () => {
    if (!file) return;
    // The save dialog must open straight from the click.
    let target: SaveTarget;
    try {
      target = await chooseSaveTarget(outputName(file.name, "captioned", ".mp4"), "video/mp4", ".mp4");
    } catch (err) {
      if (err instanceof SaveCancelledError) return;
      setJob({ kind: "error", message: (err as Error).message });
      return;
    }
    await runJob("Drawing captions into the video", async (signal, onProgress) => {
      const { burnInCaptions } = await import("@/lib/client/burn-in");
      const result = await burnInCaptions(file, captions, target, { signal, onProgress, style });
      if (result.blob) downloadBlob(result.blob, target.name);
      return [`Saved ${target.name}.`, ...result.warnings].join(" ");
    });
  };

  const base = (file?.name ?? "captions").replace(/\.[^.]+$/, "") || "captions";

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="export-menu"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={unavailable}
        className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {running ? `Exporting ${Math.round(job.progress * 100)}%` : "Export"}
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 flex w-80 flex-col gap-1 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <MenuButton
            title="Export video (.mp4)"
            detail="Captions drawn into the picture — works everywhere. Re-encodes, so it takes a while."
            onClick={burnIn}
            disabled={off}
          />
          <MenuButton
            title="Download .srt"
            detail="Plain subtitle file for any editor or player."
            onClick={() => downloadText(toSrt(captions), `${base}.srt`, "application/x-subrip")}
            disabled={off}
          />
          <MenuButton
            title="Download .vtt"
            detail="Web subtitle track for the browser's own player."
            onClick={() => downloadText(toVtt(captions), `${base}.vtt`, "text/vtt")}
            disabled={off}
          />

          {running && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs" data-testid="export-status">
              <progress className="h-1.5 flex-1" value={job.progress} max={1} />
              <span className="text-zinc-500">{job.label}</span>
              <button type="button" className="underline" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          )}
          {job.kind === "done" && (
            <p className="px-2 py-1.5 text-xs text-zinc-500" data-testid="export-status">
              {job.message}
            </p>
          )}
          {job.kind === "error" && (
            <p className="px-2 py-1.5 text-xs text-red-600" data-testid="export-status">
              Export failed: {job.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuButton({
  title,
  detail,
  onClick,
  disabled,
}: {
  title: string;
  detail: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-900"
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-zinc-500">{detail}</span>
    </button>
  );
}
