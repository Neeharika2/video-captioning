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
import type { Caption } from "@/lib/types";

type Job =
  | { kind: "idle" }
  | { kind: "running"; label: string; progress: number }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

type Props = {
  file: File;
  captions: Caption[];
  highlightWords: boolean;
  onHighlightWordsChange: (value: boolean) => void;
  disabled?: boolean;
};

export function ExportPanel({ file, captions, highlightWords, onHighlightWordsChange, disabled }: Props) {
  const [job, setJob] = useState<Job>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const running = job.kind === "running";
  const off = disabled || running || captions.length === 0;

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
      const result = await burnInCaptions(file, captions, target, { signal, onProgress, highlightWords });
      if (result.blob) downloadBlob(result.blob, target.name);
      return [`Saved ${target.name}.`, ...result.warnings].join(" ");
    });
  };

  const base = file.name.replace(/\.[^.]+$/, "") || "captions";

  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6"
      data-testid="export"
    >
      <h2 className="text-lg font-medium">Download</h2>

      <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
          checked={highlightWords}
          onChange={(e) => onHighlightWordsChange(e.target.checked)}
        />
        Highlight each word as it’s spoken (preview and burned-in video)
      </label>

      <ExportButton
        onClick={burnIn}
        disabled={off}
        title="Video with captions burned in (.mp4)"
        detail="Always visible, works everywhere (WhatsApp, Instagram, YouTube). Re-encodes the video, so it takes a while."
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={off}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
          onClick={() => downloadText(toSrt(captions), `${base}.srt`, "application/x-subrip")}
        >
          Download .srt
        </button>
        <button
          type="button"
          disabled={off}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
          onClick={() => downloadText(toVtt(captions), `${base}.vtt`, "text/vtt")}
        >
          Download .vtt
        </button>
      </div>

      {job.kind === "running" && (
        <div className="flex items-center gap-3" data-testid="export-status">
          <progress className="h-2 flex-1" value={job.progress} max={1} />
          <span className="text-zinc-500">
            {job.label} {Math.round(job.progress * 100)}%
          </span>
          <button type="button" className="underline" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {job.kind === "done" && (
        <p className="text-zinc-500" data-testid="export-status">
          {job.message}
        </p>
      )}
      {job.kind === "error" && (
        <p className="text-red-600" data-testid="export-status">
          Export failed: {job.message}
        </p>
      )}
    </section>
  );
}

function ExportButton({
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
      className="flex flex-col gap-1 rounded-xl border border-zinc-300 p-4 text-left transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      <span className="font-medium">{title}</span>
      <span className="text-xs text-zinc-500">{detail}</span>
    </button>
  );
}
