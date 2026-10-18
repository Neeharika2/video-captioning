"use client";

import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranscribeResponse } from "@/lib/api-types";
import type { ExtractEngine, ExtractResult } from "@/lib/client/extract-audio";
import { downloadText } from "@/lib/client/save-file";
import { offsetWords, TranscribeError } from "@/lib/client/transcribe-client";
import { groupWords } from "@/lib/group-words";
import { hasNonLatinLetters, romanize } from "@/lib/romanize";
import { latinPunctuation, parseGlossary, type SpelledWord } from "@/lib/spelling";
import type { Word } from "@/lib/types";
import { CaptionPlayer } from "./caption-player";
import { ExportPanel } from "./export-panel";

/** Phase 1 limit (PLAN.md): one ≤10 min chunk per video. */
const MAX_SECONDS = 600;
const STORAGE_KEY = "vc.debug.settings";

type Status =
  | { step: "idle" }
  | { step: "extracting"; progress: number; engine: ExtractEngine }
  | { step: "uploading"; progress: number }
  | { step: "transcribing"; since: number }
  | { step: "done" }
  | { step: "error"; message: string };

/** "roman": non-English speech written in English letters ("ela unnaru", "aap kaise ho"). */
type CaptionScript = "roman" | "original";
type Settings = {
  languages: string;
  engine: "auto" | ExtractEngine;
  highlightWords: boolean;
  script: CaptionScript;
  /** Gemini pass that fixes romanized spelling and restores English words. */
  smartSpelling: boolean;
  /** Terms to spell exactly, comma or newline separated. */
  glossary: string;
};

type SpellStatus =
  | { step: "idle" }
  | { step: "running"; done: number; total: number }
  | { step: "done"; message: string; warn: boolean };

function loadSettings(): Settings {
  const fallback: Settings = {
    languages: "",
    engine: "auto",
    highlightWords: true,
    script: "roman",
    smartSpelling: true,
    glossary: "",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Settings>;
    return {
      languages: saved.languages ?? fallback.languages,
      engine: saved.engine ?? fallback.engine,
      highlightWords: saved.highlightWords ?? fallback.highlightWords,
      // Not restored: captions always start in English letters.
      script: fallback.script,
      smartSpelling: saved.smartSpelling ?? fallback.smartSpelling,
      glossary: typeof saved.glossary === "string" ? saved.glossary : fallback.glossary,
    };
  } catch {
    return fallback;
  }
}

/** Client-only (rendered with ssr: false), so reading localStorage on first render is safe. */
export function PipelineDebug() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [extract, setExtract] = useState<ExtractResult | null>(null);
  const [result, setResult] = useState<TranscribeResponse | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [status, setStatus] = useState<Status>({ step: "idle" });
  const [log, setLog] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const spellAbortRef = useRef<AbortController | null>(null);
  /** Smart-spelling result per word (null = keep rule-based spelling). */
  const [spelled, setSpelled] = useState<(SpelledWord | null)[] | null>(null);
  const [spellStatus, setSpellStatus] = useState<SpellStatus>({ step: "idle" });
  const hasForeign = useMemo(() => words.some((w) => hasNonLatinLetters(w.text)), [words]);
  // Same words and timings, only respelled. Smart spelling wins where it
  // passed its checks; otherwise the instant rule-based spelling is used.
  const displayWords = useMemo(
    () =>
      words.map((w, i): Word => {
        const sp = spelled?.[i];
        if (settings.script === "roman") return { ...w, text: sp ? sp.text : latinPunctuation(romanize(w.text)) };
        // Original script, but English words back in English spelling.
        return sp?.english ? { ...w, text: sp.text } : w;
      }),
    [words, spelled, settings.script],
  );
  // Caption cues on the video timeline, built from the word timings.
  const captions = useMemo(() => groupWords(displayWords), [displayWords]);
  const romanized = settings.script === "roman" && hasForeign;
  const language = romanized ? undefined : settings.languages.split(",")[0]?.trim() || undefined;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  }, [settings]);

  // Object URLs must be revoked when replaced.
  useEffect(() => () => void (videoUrl && URL.revokeObjectURL(videoUrl)), [videoUrl]);
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);

  // Follow playback; only re-render when the active word changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const tick = () => {
      setActiveIndex(findActive(words, video.currentTime));
      if (!video.paused) raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    video.addEventListener("play", start);
    video.addEventListener("seeked", tick);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", start);
      video.removeEventListener("seeked", tick);
    };
  }, [videoUrl, words]);

  // Elapsed-time display while waiting on the server.
  useEffect(() => {
    if (status.step !== "transcribing") return;
    const since = status.since;
    const t = setInterval(() => setElapsedSec(Math.round((Date.now() - since) / 1000)), 500);
    return () => clearInterval(t);
  }, [status]);

  const addLog = useCallback((line: string) => {
    setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${line}`]);
  }, []);

  const runSpelling = async (source: Word[]) => {
    spellAbortRef.current?.abort();
    setSpelled(null);
    if (!settings.smartSpelling || !source.some((w) => hasNonLatinLetters(w.text))) {
      setSpellStatus({ step: "idle" });
      return;
    }
    const abort = new AbortController();
    spellAbortRef.current = abort;
    const total = source.length;
    let done = 0;
    setSpellStatus({ step: "running", done, total });
    const started = Date.now();
    try {
      const { spellWords } = await import("@/lib/client/spell-client");
      const summary = await spellWords(
        source.map((w) => w.text),
        {
          glossary: parseGlossary(settings.glossary),
          languages: languageList(settings.languages),
          signal: abort.signal,
          onBatch: (start, results) => {
            setSpelled((prev) => {
              const next = prev ? [...prev] : new Array<SpelledWord | null>(total).fill(null);
              results.forEach((r, k) => (next[start + k] = r));
              return next;
            });
            done += results.length;
            setSpellStatus({ step: "running", done, total });
          },
        },
      );
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const kept = summary.rejected + summary.failed;
      addLog(
        `Smart spelling (${summary.model ?? "n/a"}) in ${secs} s: ${summary.accepted} words checked, ` +
          `${summary.rejected} answers rejected, ${summary.failed} words in failed batches` +
          (summary.lastError ? ` (${summary.lastError})` : ""),
      );
      setSpellStatus(
        summary.failed && !summary.accepted
          ? { step: "done", warn: true, message: `Smart spelling failed (${summary.lastError}); showing basic spelling.` }
          : {
              step: "done",
              warn: kept > 0,
              message: kept
                ? `Spelling fixed. ${kept} word${kept === 1 ? "" : "s"} kept basic spelling.`
                : "Spelling fixed.",
            },
      );
    } catch (err) {
      if (abort.signal.aborted) return;
      setSpellStatus({ step: "done", warn: true, message: `Smart spelling failed: ${(err as Error).message}` });
    }
  };

  const pickFile = (f: File | null) => {
    abortRef.current?.abort();
    spellAbortRef.current?.abort();
    setSpelled(null);
    setSpellStatus({ step: "idle" });
    setFile(f);
    setVideoUrl(f ? URL.createObjectURL(f) : null);
    setAudioUrl(null);
    setExtract(null);
    setResult(null);
    setWords([]);
    setStatus({ step: "idle" });
    setLog(f ? [`Picked ${f.name} (${mb(f.size)})`] : []);
  };

  const run = async () => {
    if (!file) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setResult(null);
    setWords([]);
    spellAbortRef.current?.abort();
    setSpelled(null);
    setSpellStatus({ step: "idle" });
    try {
      // 1. Extract
      setStatus({ step: "extracting", progress: 0, engine: settings.engine === "ffmpeg" ? "ffmpeg" : "mediabunny" });
      const { extractAudio } = await import("@/lib/client/extract-audio");
      const ex = await extractAudio(file, {
        signal: abort.signal,
        engine: settings.engine === "auto" ? undefined : settings.engine,
        onProgress: (progress, engine) => setStatus({ step: "extracting", progress, engine }),
      });
      setExtract(ex);
      setAudioUrl(URL.createObjectURL(ex.audio));
      addLog(
        `Extracted with ${ex.engine} in ${(ex.elapsedMs / 1000).toFixed(1)} s → ${mb(ex.audio.size)}, ` +
          `${ex.durationSec.toFixed(1)} s audio, starts at ${ex.startOffsetSec.toFixed(3)} s` +
          (ex.fallbackReason ? ` (fallback: ${ex.fallbackReason})` : ""),
      );
      if (ex.durationSec > MAX_SECONDS) {
        throw new Error(`Audio is ${(ex.durationSec / 60).toFixed(1)} min; this phase supports up to 10 min.`);
      }

      // 2. Upload + transcribe
      setStatus({ step: "uploading", progress: 0 });
      const { transcribeChunk } = await import("@/lib/client/transcribe-client");
      const languages = languageList(settings.languages);
      const sentAt = Date.now();
      const res = await transcribeChunk(ex.audio, {
        languages,
        signal: abort.signal,
        onUploadProgress: (p) =>
          setStatus((prev) => {
            if (p < 1) return { step: "uploading", progress: p };
            if (prev.step === "transcribing") return prev;
            setElapsedSec(0);
            return { step: "transcribing", since: Date.now() };
          }),
        onRetry: (attempt, err) => addLog(`Attempt ${attempt} failed (${err.message}); retrying…`),
      });
      setResult(res);
      const timed = offsetWords(res.words, ex.startOffsetSec);
      setWords(timed);
      addLog(
        `Transcribed in ${((Date.now() - sentAt) / 1000).toFixed(1)} s → ${res.words.length} words ` +
          `(server-measured ${res.durationSec.toFixed(1)} s; quota ${Math.round(res.quota.usedSeconds / 60)}/${Math.round(res.quota.limitSeconds / 60)} min)`,
      );
      setStatus({ step: "done" });
      void runSpelling(timed);
    } catch (err) {
      const message =
        err instanceof TranscribeError ? `${err.message} [${err.status || ""} ${err.code}]` : (err as Error).message;
      addLog(`Error: ${message}`);
      setStatus({ step: "error", message });
    }
  };

  const downloadWords = () => {
    if (!result) return;
    const json = JSON.stringify({ ...result, words, spelled, captions }, null, 2);
    downloadText(json, `${file?.name ?? "words"}.words.json`, "application/json");
  };
  const busy = status.step === "extracting" || status.step === "uploading" || status.step === "transcribing";
  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) pickFile(dropped);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3">
        <span className="w-fit rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Your video never leaves your device
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Add captions to your video</h1>
        <p className="max-w-2xl text-zinc-500">
          Pick a video and we&apos;ll transcribe the speech and time every caption. Only the compressed audio is sent to
          the server and Google — never the video itself.
        </p>
      </header>

      <section className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*,.mkv,.mov"
          data-testid="file-input"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />

        {!file ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition ${
              dragOver
                ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
                : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-zinc-500" aria-hidden="true">
                <path
                  d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="font-medium">Drop a video here, or click to choose</span>
            <span className="text-xs text-zinc-500">MP4, MOV, MKV, WebM, AVI — up to 10 minutes</span>
          </button>
        ) : (
          <div className="flex flex-col gap-5">
            {videoUrl && (
              <CaptionPlayer
                src={videoUrl}
                captions={captions}
                language={language}
                highlightWords={settings.highlightWords}
                videoRef={videoRef}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-zinc-500">{mb(file.size)}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-900 disabled:opacity-40 dark:hover:text-zinc-100"
                >
                  Choose another
                </button>
                {busy ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={run}
                    className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {status.step === "done" ? "Redo captions" : "Make captions"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {status.step !== "idle" && (
          <div className="flex flex-col gap-2.5" data-testid="progress">
            {status.step !== "done" && status.step !== "error" && (
              <ProgressBar value={status.step === "transcribing" ? undefined : status.progress} />
            )}
            <StatusLine status={status} elapsedSec={elapsedSec} />
          </div>
        )}
      </section>

      {captions.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-medium">Captions</h2>
              <span className="text-xs text-zinc-500">{captions.length} lines · click one to jump</span>
            </div>
            {hasForeign && (
              <ScriptToggle value={settings.script} onChange={(script) => setSettings({ ...settings, script })} />
            )}
          </div>
          <SpellStatusLine status={spellStatus} />
          <ol
            className="max-h-80 divide-y divide-zinc-100 overflow-auto rounded-2xl border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800"
            data-testid="captions"
          >
            {captions.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => seek(c.start)}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-zinc-400">{clock(c.start)}</span>
                  <span>{c.lines?.join(" ") ?? c.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {file && captions.length > 0 && (
        <ExportPanel
          file={file}
          captions={captions}
          highlightWords={settings.highlightWords}
          onHighlightWordsChange={(highlightWords) => setSettings({ ...settings, highlightWords })}
          disabled={busy}
        />
      )}

      <details className="group rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <summary
          data-testid="advanced"
          className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-zinc-600 marker:content-none hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 [&::-webkit-details-marker]:hidden"
        >
          Advanced options
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true">
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="flex flex-col gap-5 border-t border-zinc-100 px-5 py-5 dark:border-zinc-900">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Language hints (optional)</span>
            <input
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              value={settings.languages}
              onChange={(e) => setSettings({ ...settings, languages: e.target.value })}
              placeholder="te-IN,en-IN"
            />
            <span className="text-xs text-zinc-500">Comma-separated BCP-47 codes. Leave empty to auto-detect.</span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Extraction engine</span>
            <select
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              value={settings.engine}
              onChange={(e) => setSettings({ ...settings, engine: e.target.value as Settings["engine"] })}
            >
              <option value="auto">Auto (Mediabunny, fallback ffmpeg)</option>
              <option value="mediabunny">Mediabunny only</option>
              <option value="ffmpeg">ffmpeg.wasm only</option>
            </select>
          </label>

          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={settings.smartSpelling}
                onChange={(e) => setSettings({ ...settings, smartSpelling: e.target.checked })}
              />
              <span>
                <span className="font-medium">Smart spelling</span>
                <span className="block text-xs text-zinc-500">
                  After transcribing, a quick Gemini pass writes every word in natural English letters and fixes
                  English words written in another script (టాపిక్ → topic, एलएलएम → LLMs). Timings don&apos;t
                  change. Turn off to compare with the basic spelling.
                </span>
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Glossary (optional)</span>
              <textarea
                rows={2}
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                value={settings.glossary}
                onChange={(e) => setSettings({ ...settings, glossary: e.target.value })}
                placeholder="LLMs, Kubernetes, Neeharika"
              />
              <span className="text-xs text-zinc-500">
                Names and technical terms to spell exactly like this. Comma or newline separated.
              </span>
            </label>
            {words.length > 0 && (
              <button
                type="button"
                disabled={busy || spellStatus.step === "running" || !settings.smartSpelling || !hasForeign}
                onClick={() => void runSpelling(words)}
                className="w-fit text-sm underline disabled:opacity-40"
              >
                Re-check spelling with this glossary
              </button>
            )}
          </div>

          {extract && audioUrl && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">
                Extracted audio ({extract.engine}, {mb(extract.audio.size)})
              </span>
              <audio src={audioUrl} controls className="w-full" />
              <a href={audioUrl} download={`${file?.name ?? "audio"}.ogg`} className="w-fit text-xs underline">
                Download .ogg
              </a>
            </div>
          )}

          {result && (
            <button type="button" className="w-fit text-sm underline" onClick={downloadWords}>
              Download words JSON
            </button>
          )}

          {words.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Word timings ({words.length})</span>
              <div className="flex max-h-72 flex-wrap gap-1 overflow-auto" data-testid="words">
                {displayWords.map((w, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => seek(w.start)}
                    title={`${w.start.toFixed(2)}–${w.end.toFixed(2)} s${w.speaker ? ` · ${w.speaker}` : ""}`}
                    className={`rounded px-1.5 py-0.5 text-sm ${
                      i === activeIndex ? "bg-amber-300 text-black" : "bg-zinc-100 dark:bg-zinc-900"
                    }`}
                  >
                    {w.text}
                    <span className="ml-1 text-[10px] text-zinc-500">{w.start.toFixed(1)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Log</span>
            <ol
              className="max-h-40 overflow-auto rounded-lg bg-zinc-100 p-3 font-mono text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
              data-testid="log"
            >
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          </div>
        </div>
      </details>
    </div>
  );
}

function SpellStatusLine({ status }: { status: SpellStatus }) {
  if (status.step === "idle") return null;
  if (status.step === "running") {
    return (
      <p className="text-xs text-zinc-500" data-testid="spell-status">
        Fixing spelling… {status.total ? Math.round((status.done / status.total) * 100) : 0}%
      </p>
    );
  }
  return (
    <p
      className={`text-xs ${status.warn ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
      data-testid="spell-status"
    >
      {status.message}
    </p>
  );
}

function ScriptToggle({ value, onChange }: { value: CaptionScript; onChange: (v: CaptionScript) => void }) {
  const options: { value: CaptionScript; label: string; example: string }[] = [
    { value: "roman", label: "English letters", example: "ela unnaru · aap kaise ho · privet" },
    { value: "original", label: "Original script", example: "ఎలా ఉన్నారు · आप कैसे हो · привет" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Caption script"
      className="flex rounded-full border border-zinc-200 p-0.5 text-xs dark:border-zinc-800"
      data-testid="script-toggle"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.example}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 transition ${
            value === o.value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ProgressBar({ value }: { value?: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      <div
        className={`h-full rounded-full bg-zinc-900 transition-[width] duration-300 dark:bg-zinc-100 ${
          value === undefined ? "w-1/3 animate-pulse" : ""
        }`}
        style={value === undefined ? undefined : { width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

function StatusLine({ status, elapsedSec }: { status: Status; elapsedSec: number }) {
  const { text, tone } = ((): { text: string; tone: "idle" | "busy" | "done" | "error" } => {
    switch (status.step) {
      case "idle":
        return { text: "", tone: "idle" };
      case "extracting":
        return { text: `Extracting audio… ${Math.round(status.progress * 100)}%`, tone: "busy" };
      case "uploading":
        return { text: `Uploading audio… ${Math.round(status.progress * 100)}%`, tone: "busy" };
      case "transcribing":
        return { text: `Transcribing… ${elapsedSec}s`, tone: "busy" };
      case "done":
        return { text: "Done", tone: "done" };
      case "error":
        return { text: `Error: ${status.message}`, tone: "error" };
    }
  })();
  const className =
    tone === "error"
      ? "text-red-600"
      : tone === "done"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-zinc-500";
  return (
    <span className={`flex items-center gap-2 text-sm ${className}`} data-testid="status">
      {tone === "done" && (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
          <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {text}
    </span>
  );
}

/** Index of the word being spoken at `t`, or of the last word before it if in a short gap. */
function findActive(words: Word[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (ans >= 0 && t - words[ans].end > 1.5) return -1;
  return ans;
}

function languageList(text: string) {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function mb(bytes: number) {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
