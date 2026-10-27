"use client";

import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TranscribeResponse } from "@/lib/api-types";
import { extractAudioRange, hasSpeech, type ExtractEngine, type ExtractResult } from "@/lib/client/extract-audio";
import {
  coverageRatio,
  findCoverageGaps,
  mergeWords,
  planWindows,
  splitRange,
  type TimeRange,
} from "@/lib/client/caption-coverage";
import { downloadText } from "@/lib/client/save-file";
import {
  deleteProject as deleteStoredProject,
  getProject,
  getVideo,
  listProjects,
  newProjectId,
  requestPersistence,
  saveProject,
  storageEstimate,
  type ProjectSummary,
  type SavedProject,
  type StorageEstimate,
} from "@/lib/client/project-store";
import { captureThumbnail } from "@/lib/client/thumbnail";
import { offsetWords, TranscribeError } from "@/lib/client/transcribe-client";
import { clearApiKey, getApiKey, setApiKey as storeApiKey } from "@/lib/client/api-key";
import { numberSpeakers } from "@/lib/caption-effects";
import { detectLanguage, formatLanguage } from "@/lib/detect-language";
import { DEFAULT_GROUP_OPTIONS, groupWords, wrapLines } from "@/lib/group-words";
import { hasNonLatinLetters, romanize } from "@/lib/romanize";
import { latinPunctuation, parseGlossary, type SpelledWord } from "@/lib/spelling";
import type { Caption, Word } from "@/lib/types";
import { DEFAULT_STYLE, normalizeStyle, type CaptionPlacement, type CaptionStyle } from "@/lib/caption-style";
import { CaptionPlayer } from "./caption-player";
import { ExportMenu } from "./export-menu";
import { ApiKeyField } from "./api-key-field";
import { ProjectsLibrary } from "./projects-library";
import { StylePicker } from "./style-picker";
import { Timeline } from "./timeline";
import { ToastStack, useToasts } from "./toast";

/** Phase 1 limit (PLAN.md): one ≤10 min chunk per video. */
const MAX_SECONDS = 600;
const STORAGE_KEY = "vc.debug.settings";
/**
 * Auto-detect reads one language per request, so the whole track is tried first
 * and whatever it skipped is re-transcribed on its own. A missing stretch must
 * be at least this long to be worth a request.
 */
const MIN_REPAIR_GAP_SEC = 2.5;
/** Never spend a request on a stretch shorter than this. */
const MIN_CHUNK_SEC = 2;
/** Longest stretch one repair request may cover before it is windowed. */
const MAX_CHUNK_SEC = 20;
/** Hard cap on requests per video, so silence/music can't run away. */
const MAX_REQUESTS = 40;
/** How far the halving recursion may go. */
const MAX_REPAIR_DEPTH = 6;
/** Cap on splits caused by a request returning nothing (music/silence can do this). */
const MAX_EMPTY_SPLITS = 6;

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
  /** Look of the captions in the preview and the burned-in export. */
  style: CaptionStyle;
  script: CaptionScript;
  /** Terms to spell exactly, comma or newline separated. */
  glossary: string;
  /** Ask transcription for speaker labels (for speaker colours). */
  speakers: boolean;
};

type SpellStatus =
  | { step: "idle" }
  | { step: "running"; done: number; total: number }
  | { step: "done"; message: string; warn: boolean };

/** Whether the current project is safely in this browser's database. */
type SaveState = "idle" | "saving" | "saved" | "unsaved" | "error";

function loadSettings(): Settings {
  const fallback: Settings = {
    style: DEFAULT_STYLE,
    script: "roman",
    glossary: "",
    speakers: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Settings>;
    return {
      // Validated and upgraded from older saves (new effect settings get defaults).
      style: normalizeStyle(saved.style, fallback.style),
      // Not restored: captions always start in English letters.
      script: fallback.script,
      glossary: typeof saved.glossary === "string" ? saved.glossary : fallback.glossary,
      speakers: typeof saved.speakers === "boolean" ? saved.speakers : fallback.speakers,
    };
  } catch {
    return fallback;
  }
}

/**
 * Extraction engine override for debugging and tests: `/debug?engine=ffmpeg`.
 * The engine picker was removed from the UI; the default is Auto — Mediabunny
 * with an ffmpeg.wasm fallback. Smart spelling is likewise always on.
 */
function engineOverride(): ExtractEngine | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("engine");
  return value === "ffmpeg" || value === "mediabunny" ? value : null;
}

/**
 * Auto-repair switch for tests: `/debug?repair=off` keeps the single whole-track
 * request so UI tests don't fan out into extra calls. Production always repairs.
 */
function repairDisabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("repair") === "off";
}

/** "1:05" for the log lines. */
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  const [tab, setTab] = useState<"style" | "settings">("style");
  /** The visitor's own Gemini key; null until they add one. */
  const [apiKey, setApiKey] = useState<string | null>(getApiKey);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const spellAbortRef = useRef<AbortController | null>(null);
  /** Smart-spelling result per word (null = keep rule-based spelling). */
  const [spelled, setSpelled] = useState<(SpelledWord | null)[] | null>(null);
  const [spellStatus, setSpellStatus] = useState<SpellStatus>({ step: "idle" });
  /**
   * Punchline word indices per cue id, from the Gemini pass. Cues without an
   * entry fall back to the local pick in the renderer.
   */
  const [punchlines, setPunchlines] = useState<Record<string, number[]>>({});
  const punchlineAbortRef = useRef<AbortController | null>(null);
  /** Skips the punchline pass once, right after a saved project is reopened. */
  const suppressPunchlinesRef = useRef(false);
  /** The captions the punchline pass last ran on, so it runs once per transcript. */
  const punchlineSourceRef = useRef<Caption[] | null>(null);

  // --- Projects saved in this browser -------------------------------------
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  /** The id of the saved project being edited; null until the first save. */
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  /** The project's display name (file name, or the reopened project's name). */
  const [projectName, setProjectName] = useState("New project");
  // Mirrors of the state the autosave writes, so an async save never reads a
  // stale render.
  const projectIdRef = useRef<string | null>(null);
  const createdAtRef = useRef(0);
  const thumbnailRef = useRef<string | null>(null);
  const videoStoredRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  /** A save asked for while another was running, replayed once it finishes. */
  const pendingSaveRef = useRef<{ withVideo: boolean } | null>(null);
  const persistRef = useRef<(opts: { withVideo: boolean }) => Promise<void>>(async () => {});
  const hasForeign = useMemo(() => words.some((w) => hasNonLatinLetters(w.text)), [words]);
  /**
   * Spoken language, read back from the transcript's script after transcription.
   * Read-only: transcription always auto-detects (we never send a hint, which is
   * how one video's language once leaked onto the next).
   */
  const detected = useMemo(() => detectLanguage(words.map((w) => w.text)), [words]);
  // Same words and timings, only respelled. Smart spelling wins where it
  // passed its checks; otherwise the instant rule-based spelling is used.
  // Each word also carries its spelling in the other script (`alt`) for the
  // bilingual caption line, and speakers are numbered 0, 1, … by first appearance.
  const displayWords = useMemo(
    () =>
      numberSpeakers(
        words.map((w, i): Word => {
          const sp = spelled?.[i];
          const roman = sp ? sp.text : latinPunctuation(romanize(w.text));
          if (settings.script === "roman") return { ...w, text: roman, alt: w.text };
          // Original script, but English words back in English spelling.
          return { ...w, text: sp?.english ? sp.text : w.text, alt: roman };
        }),
      ),
    [words, spelled, settings.script],
  );
  /** User text edits, per cue id. Cleared whenever the captions are rebuilt. */
  const [captionEdits, setCaptionEdits] = useState<Record<string, string>>({});
  /** User timing overrides, per cue id, set by dragging on the timeline. */
  const [captionTimings, setCaptionTimings] = useState<Record<string, { start: number; end: number }>>({});
  /** Per-caption placement overrides, set by dragging a caption in the preview. */
  const [captionPlacements, setCaptionPlacements] = useState<Record<string, CaptionPlacement>>({});
  /** Per-caption font-size overrides, set by dragging a corner in the preview. */
  const [captionScales, setCaptionScales] = useState<Record<string, number>>({});
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Caption cues on the video timeline, built from the word timings.
  // Ids carry the words-per-caption setting, so edits, timings and placements
  // made at one grouping never land on a different cue at another.
  const wordsPerCaption = settings.style.wordsPerCaption;
  const baseCaptions = useMemo(
    () =>
      groupWords(displayWords, { maxWords: wordsPerCaption }).map((c) =>
        wordsPerCaption === DEFAULT_GROUP_OPTIONS.maxWords ? c : { ...c, id: `${c.id}-of-${wordsPerCaption}` },
      ),
    [displayWords, wordsPerCaption],
  );
  // Text and timing edits win over the derived cues; edited text is re-wrapped
  // to keep the two-line layout. Dragging clamps cues between their neighbours,
  // so the list stays sorted for `findCaptionAt`. Punchline indices from the
  // Gemini pass ride along, but are dropped for a cue whose text was edited
  // (the stored indices no longer describe the words on screen).
  const captions = useMemo(
    () =>
      baseCaptions.map((c) => {
        const timing = captionTimings[c.id];
        const placement = captionPlacements[c.id];
        const scale = captionScales[c.id];
        const edited = captionEdits[c.id];
        const hasText = edited !== undefined && edited !== c.text;
        const punchline = hasText ? undefined : punchlines[c.id];
        if (!timing && !placement && scale === undefined && !hasText && !punchline) return c;
        const next = { ...c };
        if (timing) {
          next.start = timing.start;
          next.end = timing.end;
        }
        if (placement) next.placement = placement;
        if (scale !== undefined) next.scale = scale;
        if (hasText) {
          next.text = edited;
          next.lines = wrapLines(edited, DEFAULT_GROUP_OPTIONS.maxCharsPerLine, DEFAULT_GROUP_OPTIONS.maxLines);
        }
        if (punchline) next.punchlineWordIndices = punchline;
        return next;
      }),
    [baseCaptions, captionEdits, captionTimings, captionPlacements, captionScales, punchlines],
  );
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

  /** Keep the header source of truth (localStorage) in sync with the UI. */
  const updateApiKey = useCallback((key: string | null) => {
    setApiKey(key);
    if (key) storeApiKey(key);
    else clearApiKey();
  }, []);

  /** Reload the library grid and the storage read-out. */
  const refreshProjects = useCallback(async () => {
    const [list, used] = await Promise.all([listProjects(), storageEstimate()]);
    setProjects(list);
    setStorage(used);
    setProjectsLoading(false);
  }, []);

  // Load the library once on mount. The state is written after an await, so the
  // effect never sets state synchronously.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [list, used] = await Promise.all([listProjects(), storageEstimate()]);
      if (!live) return;
      setProjects(list);
      setStorage(used);
      setProjectsLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  /**
   * Write the current workspace to this browser's database. The video Blob is
   * stored on the first save (and whenever it was missing); later saves only
   * carry the transcript, edits and style. A refused video (quota) keeps the
   * project and flags it "video not saved".
   */
  const persistProject = useCallback(
    async ({ withVideo }: { withVideo: boolean }) => {
      if (!file && !words.length) return;
      if (savingRef.current) {
        // A save is already running; remember to write again with the newer state.
        pendingSaveRef.current = { withVideo: withVideo || Boolean(pendingSaveRef.current?.withVideo) };
        return;
      }
      savingRef.current = true;
      try {
        // One frame per project, grabbed the first time the video is stored.
        if (withVideo && file && !thumbnailRef.current) {
          const shot = await captureThumbnail(file);
          if (shot) thumbnailRef.current = shot;
        }
        const id = projectIdRef.current ?? newProjectId();
        projectIdRef.current = id;
        const project: SavedProject = {
          id,
          name: projectName,
          createdAt: createdAtRef.current || Date.now(),
          updatedAt: Date.now(),
          bytes: file?.size ?? 0,
          mimeType: file?.type ?? "",
          durationSec: extract?.durationSec ?? result?.durationSec,
          thumbnail: thumbnailRef.current ?? undefined,
          hasVideo: videoStoredRef.current || withVideo,
          settings: {
            style: settings.style,
            script: settings.script,
            glossary: settings.glossary,
            speakers: settings.speakers,
          },
          words,
          spelled,
          result,
          punchlines,
          captionEdits,
          captionTimings,
          captionPlacements,
          captionScales,
        };
        setSaveState("saving");
        const res = await saveProject(project, withVideo ? file : null);
        if (!res.ok) {
          setSaveState("error");
          pushToast("Couldn't save this project in your browser. Storage may be full.", "error");
          return;
        }
        videoStoredRef.current = res.videoStored;
        setSaveState("saved");
        if (withVideo && !res.videoStored) {
          pushToast("Project saved, but the video was too big to keep — you can re-attach it when you reopen.", "info");
        }
        void requestPersistence();
        void refreshProjects();
      } finally {
        savingRef.current = false;
      }
      const queued = pendingSaveRef.current;
      if (queued) {
        pendingSaveRef.current = null;
        void persistRef.current(queued);
      }
    },
    [
      file,
      projectName,
      words,
      spelled,
      result,
      punchlines,
      captionEdits,
      captionTimings,
      captionPlacements,
      captionScales,
      settings,
      extract,
      pushToast,
      refreshProjects,
    ],
  );

  // Keep the replayed-save call pointing at the newest closure (latest state).
  useEffect(() => {
    persistRef.current = persistProject;
  }, [persistProject]);

  // Autosave: once captions exist, write them shortly after the user stops
  // changing things. `persistProject` changes with every edit, so the effect
  // re-runs (and the timer resets) on each one — a debounce, not a loop.
  const hasCaptions = words.length > 0;
  useEffect(() => {
    if (!hasCaptions) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistProject({ withVideo: !videoStoredRef.current });
    }, 600);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [hasCaptions, persistProject]);

  /** Clear the workspace back to the Projects home. */
  const closeProject = useCallback(() => {
    abortRef.current?.abort();
    spellAbortRef.current?.abort();
    punchlineAbortRef.current?.abort();
    punchlineSourceRef.current = null;
    suppressPunchlinesRef.current = false;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    setFile(null);
    setVideoUrl(null);
    setAudioUrl(null);
    setExtract(null);
    setResult(null);
    setWords([]);
    setSpelled(null);
    setSpellStatus({ step: "idle" });
    setPunchlines({});
    setCaptionEdits({});
    setCaptionTimings({});
    setCaptionPlacements({});
    setCaptionScales({});
    setSelectedCaptionId(null);
    setEditingId(null);
    setStatus({ step: "idle" });
    setLog([]);
    projectIdRef.current = null;
    setProjectName("New project");
    createdAtRef.current = 0;
    thumbnailRef.current = null;
    videoStoredRef.current = false;
    setSaveState("idle");
    void refreshProjects();
  }, [refreshProjects]);

  /** Reopen a saved project: restore the file, transcript, style and every edit. */
  const openProject = useCallback(
    async (id: string) => {
      const project = await getProject(id);
      if (!project) {
        pushToast("That project could not be opened — it may have been deleted.", "error");
        return;
      }
      const blob = project.hasVideo ? await getVideo(id) : null;
      abortRef.current?.abort();
      spellAbortRef.current?.abort();
      punchlineAbortRef.current?.abort();
      punchlineSourceRef.current = null;
      // The restored look already has its punchline picks; don't spend a request.
      suppressPunchlinesRef.current = true;

      projectIdRef.current = id;
      createdAtRef.current = project.createdAt;
      thumbnailRef.current = project.thumbnail ?? null;
      videoStoredRef.current = Boolean(blob);
      setSaveState("saved");
      setProjectName(project.name);

      const restored = blob ? new File([blob], project.name, { type: project.mimeType || blob.type || "video/mp4" }) : null;
      setFile(restored);
      setVideoUrl(restored ? URL.createObjectURL(restored) : null);
      setAudioUrl(null);
      setExtract(null);
      setResult(project.result);
      setWords(project.words);
      setSpelled(project.spelled);
      setPunchlines(project.punchlines ?? {});
      setCaptionEdits(project.captionEdits ?? {});
      setCaptionTimings(project.captionTimings ?? {});
      setCaptionPlacements(project.captionPlacements ?? {});
      setCaptionScales(project.captionScales ?? {});
      setSettings({
        style: normalizeStyle(project.settings?.style, DEFAULT_STYLE),
        script: project.settings?.script === "original" ? "original" : "roman",
        glossary: project.settings?.glossary ?? "",
        speakers: Boolean(project.settings?.speakers),
      });
      setSpellStatus({ step: "idle" });
      setSelectedCaptionId(null);
      setEditingId(null);
      setLog([`Opened “${project.name}”`]);
      setStatus(project.words.length ? { step: "done" } : { step: "idle" });
      if (!restored) {
        pushToast("The video wasn't saved for this project — choose the file again to preview and export.", "info");
      }
    },
    [pushToast],
  );

  /** Delete a saved project (with a confirmation). */
  const removeProject = useCallback(
    async (id: string) => {
      const summary = projects.find((p) => p.id === id);
      const label = summary ? `“${summary.name}”` : "this project";
      if (typeof window !== "undefined" && !window.confirm(`Delete ${label} from this browser? This can't be undone.`)) return;
      await deleteStoredProject(id);
      if (projectIdRef.current === id) closeProject();
      else void refreshProjects();
      pushToast("Project deleted.", "success");
    },
    [projects, closeProject, refreshProjects, pushToast],
  );

  const runSpelling = async (source: Word[]) => {
    spellAbortRef.current?.abort();
    if (!source.some((w) => hasNonLatinLetters(w.text))) {
      setSpellStatus({ step: "idle" });
      return;
    }
    const abort = new AbortController();
    spellAbortRef.current = abort;
    const key = getApiKey();
    if (!key) {
      setSpellStatus({ step: "done", warn: true, message: "Add your Gemini API key in Settings to fix spelling." });
      return;
    }
    const texts = source.map((w) => w.text);
    // Applied once at the end: the caption list must not flip between the
    // rule-based and corrected spelling while the user is looking at it.
    const accumulated = new Array<SpelledWord | null>(source.length).fill(null);
    let spellingTotal = 0;
    let done = 0;
    const started = Date.now();
    try {
      const { planBatches, spellWords } = await import("@/lib/client/spell-client");
      // Only batches with non-Latin text are sent; count those words so the
      // pipeline percentage reaches 100 instead of stalling on skipped batches.
      spellingTotal = planBatches(texts)
        .filter((b) => texts.slice(b.start, b.end).some(hasNonLatinLetters))
        .reduce((n, b) => n + (b.end - b.start), 0);
      setSpellStatus({ step: "running", done, total: spellingTotal });
      const summary = await spellWords(texts, {
        apiKey: key,
        glossary: parseGlossary(settings.glossary),
        signal: abort.signal,
        onBatch: (start, results) => {
          results.forEach((r, k) => (accumulated[start + k] = r));
          done += results.length;
          setSpellStatus({ step: "running", done, total: spellingTotal });
        },
      });
      if (abort.signal.aborted) return;
      setSpelled(accumulated);
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
      if (abort.signal.aborted) {
        setSpellStatus({ step: "idle" });
        return;
      }
      setSpelled(accumulated);
      setSpellStatus({ step: "done", warn: true, message: `Smart spelling failed: ${(err as Error).message}` });
    }
  };

  /**
   * Ask Gemini which word is the punchline in each caption (the accent the
   * punchline presets mark). Only runs when the current look actually uses a
   * punchline, so ordinary captions never pay for it. Results are merged into
   * the captions below and dropped for any cue whose text was edited.
   */
  const runPunchlines = useCallback(
    async (source: Caption[]) => {
      punchlineAbortRef.current?.abort();
      const key = getApiKey();
      if (!key) {
        addLog("Punchline pass skipped: add your Gemini API key in Settings.");
        return;
      }
      const abort = new AbortController();
      punchlineAbortRef.current = abort;
      // Prefer the words (timings included); fall back to the cue text.
      const cues = source.map((c) =>
        c.words.length ? c.words.map((w) => w.text) : c.text.split(/\s+/).filter(Boolean),
      );
      const accumulated = new Array<number[] | null>(source.length).fill(null);
      const started = Date.now();
      try {
        const { pickPunchlines } = await import("@/lib/client/punchline-client");
        const summary = await pickPunchlines(cues, {
          apiKey: key,
          signal: abort.signal,
          onBatch: (start, results) => results.forEach((r, k) => (accumulated[start + k] = r)),
        });
        if (abort.signal.aborted) return;
        const picked: Record<string, number[]> = {};
        source.forEach((c, i) => {
          const p = accumulated[i];
          if (p?.length) picked[c.id] = p;
        });
        setPunchlines(picked);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        addLog(
          `Punchlines (${summary.model ?? "n/a"}) in ${secs} s: ${summary.accepted} cue${summary.accepted === 1 ? "" : "s"} picked, ` +
            `${summary.rejected} answer${summary.rejected === 1 ? "" : "s"} rejected, ${summary.failed} in failed batches` +
            (summary.lastError ? ` (${summary.lastError})` : ""),
        );
      } catch (err) {
        if (abort.signal.aborted) return;
        addLog(`Punchline pass failed: ${(err as Error).message}`);
      }
    },
    [addLog],
  );

  // Run the punchline pass once per transcript, and only when a look needs it.
  const needsPunchlines = settings.style.emphasisTarget === "keyword" || settings.style.layout !== "block";
  useEffect(() => {
    if (!needsPunchlines || !baseCaptions.length) return;
    if (punchlineSourceRef.current === baseCaptions) return;
    // A reopened project already carries its picks: adopt them without a request.
    if (suppressPunchlinesRef.current) {
      suppressPunchlinesRef.current = false;
      punchlineSourceRef.current = baseCaptions;
      return;
    }
    punchlineSourceRef.current = baseCaptions;
    void runPunchlines(baseCaptions);
  }, [needsPunchlines, baseCaptions, runPunchlines]);

  const pickFile = (f: File | null) => {
    abortRef.current?.abort();
    spellAbortRef.current?.abort();
    punchlineAbortRef.current?.abort();
    punchlineSourceRef.current = null;
    suppressPunchlinesRef.current = false;
    // A freshly picked file is a new, unsaved project.
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    projectIdRef.current = null;
    createdAtRef.current = Date.now();
    setProjectName(f?.name ?? "New project");
    thumbnailRef.current = null;
    videoStoredRef.current = false;
    setSaveState(f ? "unsaved" : "idle");
    setSpelled(null);
    setSpellStatus({ step: "idle" });
    setPunchlines({});
    setCaptionEdits({});
    setCaptionTimings({});
    setCaptionPlacements({});
    setCaptionScales({});
    setSelectedCaptionId(null);
    setEditingId(null);
    setFile(f);
    setVideoUrl(f ? URL.createObjectURL(f) : null);
    setAudioUrl(null);
    setExtract(null);
    setResult(null);
    setWords([]);
    setStatus({ step: "idle" });
    setLog(f ? [`Picked ${f.name} (${mb(f.size)})`] : []);
  };

  /**
   * Upload the extracted track and turn it into timed words (step 2 of the
   * pipeline). No language hint is sent, so Gemini detects and switches
   * languages on its own. Auto-detect reads one language per request, though, so
   * pass 1 is the whole track and every stretch it skipped is re-transcribed on
   * its own — halving any stretch that is still mixed — until each request hears
   * a single language (see lib/client/caption-coverage.ts).
   */
  const transcribeAudio = async (ex: ExtractResult, signal: AbortSignal) => {
    const { transcribeChunk } = await import("@/lib/client/transcribe-client");
    const apiKey = getApiKey() ?? "";
    const audioStart = ex.startOffsetSec;
    const audioEnd = ex.startOffsetSec + ex.durationSec;
    const startedAt = Date.now();
    const collected: Word[] = [];
    let requests = 0;
    let emptySplits = 0;

    const send = async (blob: Blob, label: string) => {
      setStatus({ step: "uploading", progress: 0 });
      requests++;
      const res = await transcribeChunk(blob, {
        apiKey,
        signal,
        speakers: settings.speakers,
        onUploadProgress: (p) =>
          setStatus((prev) => {
            if (p < 1) return { step: "uploading", progress: p };
            if (prev.step === "transcribing") return prev;
            setElapsedSec(0);
            return { step: "transcribing", since: Date.now() };
          }),
        onRetry: (attempt, err) => addLog(`Attempt ${attempt} failed (${err.message}); retrying…`),
      });
      addLog(`${label}: ${res.words.length} words (server-measured ${res.durationSec.toFixed(1)} s)`);
      return res;
    };

    // Pass 1: the whole extracted track.
    const first = await send(ex.audio, "Full track");
    const pass1 = offsetWords(first.words, audioStart);
    collected.push(...pass1);

    /**
     * Transcribe one stretch on its own. A stretch can itself hold more than one
     * language, so if it is barely covered, halve it and try each half.
     */
    const repair = async (range: TimeRange, depth: number, allowEmptySplit: boolean): Promise<void> => {
      if (signal.aborted || depth > MAX_REPAIR_DEPTH || requests >= MAX_REQUESTS) return;
      const length = range.end - range.start;
      if (length < MIN_CHUNK_SEC) return;
      if (length > MAX_CHUNK_SEC) {
        for (const window of planWindows(range, MAX_CHUNK_SEC)) await repair(window, depth + 1, allowEmptySplit);
        return;
      }
      try {
        if (!file || !(await hasSpeech(file, range.start, range.end, { signal }))) {
          addLog(`Skipped ${fmtTime(range.start)}–${fmtTime(range.end)}: no speech`);
          return;
        }
        const slice = await extractAudioRange(file, range.start, range.end, { signal });
        const res = await send(slice.audio, `Fix ${fmtTime(range.start)}–${fmtTime(range.end)}`);
        const words = offsetWords(res.words, slice.startOffsetSec);
        collected.push(...words);
        if (!words.length) {
          // Could be a silent/musical stretch or two languages the model both
          // dropped. Split a bounded number of times before giving up.
          if (allowEmptySplit && emptySplits < MAX_EMPTY_SPLITS) {
            emptySplits++;
            const [a, b] = splitRange(range);
            await repair(a, depth + 1, true);
            await repair(b, depth + 1, true);
          }
          return;
        }
        if (coverageRatio(words, range.start, range.end) < 0.5) {
          const [a, b] = splitRange(range);
          await repair(a, depth + 1, true);
          await repair(b, depth + 1, true);
        } else {
          for (const gap of findCoverageGaps(words, range.start, range.end, MIN_REPAIR_GAP_SEC)) {
            await repair(gap, depth + 1, true);
          }
        }
      } catch (err) {
        if (signal.aborted) throw err;
        if (!collected.length) throw err;
        addLog(`Stopped repairing ${fmtTime(range.start)}–${fmtTime(range.end)}: ${(err as Error).message}`);
      }
    };

    if (!repairDisabled()) {
      const gaps = findCoverageGaps(pass1, audioStart, audioEnd, MIN_REPAIR_GAP_SEC);
      if (pass1.length === 0) {
        if (file && (await hasSpeech(file, audioStart, audioEnd, { signal }))) {
          addLog("Gemini returned no words; re-transcribing in shorter sections…");
          await repair({ start: audioStart, end: audioEnd }, 1, true);
        } else if (file) {
          addLog("No speech detected in this clip.");
        }
      } else if (gaps.length) {
        addLog(
          `Gemini covered ${(coverageRatio(pass1, audioStart, audioEnd) * 100).toFixed(0)}% of the audio; ` +
            `re-transcribing ${gaps.length} missed stretch(es)…`,
        );
        for (const gap of gaps) await repair(gap, 1, true);
      }
    }

    const words = mergeWords([collected]);
    const transcribedMs = Date.now() - startedAt;
    // Publish the words only after normalization. Otherwise the caption list
    // would visibly reflow from basic to corrected spelling, and an edit made
    // in that window could land on a cue whose text has since changed.
    if (words.some((w) => hasNonLatinLetters(w.text))) {
      // Keep the "Transcribing…" status up while the normalization pass runs;
      // it is part of producing the result, not a separate visible step.
      setStatus({ step: "transcribing", since: Date.now() });
      await runSpelling(words);
      if (signal.aborted) {
        setSpellStatus({ step: "idle" });
        setStatus({ step: "idle" });
        return;
      }
    }
    setResult({ ...first, words, text: words.map((w) => w.text).join(" "), durationSec: ex.durationSec });
    setWords(words);
    addLog(
      `Transcribed in ${(transcribedMs / 1000).toFixed(1)} s → ${words.length} words ` +
        `(${requests} request${requests === 1 ? "" : "s"}, server-measured ${first.durationSec.toFixed(1)} s)`,
    );
    setStatus({ step: "done" });
  };

  const run = async () => {
    if (!file) return;
    const key = getApiKey();
    if (!key) {
      setTab("settings");
      addLog("Error: add your Gemini API key in Settings");
      setStatus({ step: "error", message: "Add your Gemini API key in Settings, then try again." });
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setResult(null);
    setWords([]);
    spellAbortRef.current?.abort();
    setSpelled(null);
    setSpellStatus({ step: "idle" });
    punchlineAbortRef.current?.abort();
    punchlineSourceRef.current = null;
    suppressPunchlinesRef.current = false;
    setPunchlines({});
    setCaptionEdits({});
    setCaptionTimings({});
    setCaptionPlacements({});
    setCaptionScales({});
    setSelectedCaptionId(null);
    setEditingId(null);
    try {
      // 1. Extract
      const forcedEngine = engineOverride();
      setStatus({ step: "extracting", progress: 0, engine: forcedEngine ?? "mediabunny" });
      const { extractAudio } = await import("@/lib/client/extract-audio");
      const ex = await extractAudio(file, {
        signal: abort.signal,
        engine: forcedEngine ?? undefined,
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

      // 2. Upload + transcribe (language is detected automatically)
      await transcribeAudio(ex, abort.signal);
    } catch (err) {
      const message =
        err instanceof TranscribeError ? `${err.message} [${err.status || ""} ${err.code}]` : (err as Error).message;
      if (err instanceof TranscribeError && err.code === "needs_api_key") setTab("settings");
      addLog(`Error: ${message}`);
      setStatus({ step: "error", message });
    }
  };

  const downloadWords = () => {
    if (!result) return;
    const json = JSON.stringify({ ...result, words, spelled, captions }, null, 2);
    downloadText(json, `${file?.name ?? "words"}.words.json`, "application/json");
  };
  const busy =
    status.step === "extracting" ||
    status.step === "uploading" ||
    status.step === "transcribing";
  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setDraft(text);
  };

  /** Save a caption edit; empty input is ignored and an unchanged edit is dropped. */
  const commitEdit = (id: string, value: string) => {
    const clean = value.replace(/\s+/g, " ").trim();
    setEditingId(null);
    if (!clean) return;
    const base = baseCaptions.find((c) => c.id === id);
    setCaptionEdits((prev) => {
      const next = { ...prev };
      if (base && clean === base.text) delete next[id];
      else next[id] = clean;
      return next;
    });
  };

  /** Move/resize a cue from the timeline; neighbours were already respected. */
  const retimeCaption = useCallback((id: string, start: number, end: number) => {
    setCaptionTimings((prev) => ({ ...prev, [id]: { start, end } }));
  }, []);

  /** Drop a cue's timing override, restoring the word-derived times. */
  const resetCaptionTiming = useCallback((id: string) => {
    setCaptionTimings((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /** Place one caption, or the default when no caption is on screen. */
  const placeCaption = useCallback((id: string | null, placement: CaptionPlacement) => {
    if (id) {
      setCaptionPlacements((prev) => ({ ...prev, [id]: placement }));
      return;
    }
    setSettings((prev) => ({
      ...prev,
      style: { ...prev.style, offsetX: placement.offsetX, offsetY: placement.offsetY },
    }));
  }, []);

  /** Clear every per-caption placement, and the default offset. */
  const resetPlacements = useCallback(() => {
    setCaptionPlacements({});
    setSettings((prev) => ({ ...prev, style: { ...prev.style, offsetX: 0, offsetY: 0 } }));
  }, []);

  /** Resize one caption, or the default style when no caption is on screen. */
  const resizeCaption = useCallback((id: string | null, scale: number) => {
    if (id) {
      setCaptionScales((prev) => ({ ...prev, [id]: scale }));
      return;
    }
    setSettings((prev) => ({ ...prev, style: { ...prev.style, scale } }));
  }, []);

  /** Apply the on-screen caption's size to every caption: it becomes the style default. */
  const syncSize = useCallback((scale: number) => {
    setCaptionScales({});
    setSettings((prev) => ({ ...prev, style: { ...prev.style, scale } }));
  }, []);

  /** Apply the on-screen caption's spot to every caption: it becomes the style default. */
  const syncPlacement = useCallback((placement: CaptionPlacement) => {
    setCaptionPlacements({});
    setSettings((prev) => ({
      ...prev,
      style: {
        ...prev.style,
        position: placement.position,
        offsetX: placement.offsetX,
        offsetY: placement.offsetY,
      },
    }));
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) pickFile(dropped);
  };

  const headerTitle = file ? file.name : projectName;
  const workspaceOpen = Boolean(file) || words.length > 0;

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 lg:h-dvh dark:bg-zinc-950">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,.mkv,.mov"
        data-testid="file-input"
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        className="sr-only"
      />

      {/* Toolbar */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <button
          type="button"
          onClick={closeProject}
          className="flex min-w-0 items-center gap-3 text-left"
          title="All projects"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
              <path d="M7 14h6M7 10h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold">{headerTitle}</p>
            <p className="truncate text-xs text-zinc-500">
              {file ? `${mb(file.size)} · your video never leaves your device` : "Add captions to any video"}
            </p>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-2">
          {saveState !== "idle" && <SaveChip state={saveState} />}
          {workspaceOpen && (
            <button
              type="button"
              onClick={closeProject}
              className="rounded-full px-3 py-2 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              Projects
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="rounded-full px-3 py-2 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            {file ? "Choose another" : "Choose video"}
          </button>
          <ExportMenu file={file} captions={captions} style={settings.style} disabled={busy} />
        </div>
      </header>

      {workspaceOpen ? (
      /* Workspace */
      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        {/* Captions */}
        <aside className="order-2 flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-zinc-200 p-4 lg:order-1 lg:border-t-0 lg:border-r dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Captions
              {captions.length > 0 && <span className="ml-1.5 font-normal text-zinc-400">{captions.length}</span>}
            </h2>
            {hasForeign && (
              <ScriptToggle value={settings.script} onChange={(script) => setSettings({ ...settings, script })} />
            )}
          </div>
          {file && !apiKey && !busy && (
            <p
              className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
              data-testid="api-key-notice"
            >
              Add your Gemini API key to make captions.{" "}
              <button type="button" className="underline" onClick={() => setTab("settings")}>
                Open settings
              </button>
            </p>
          )}
          {file &&
            (busy ? (
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  spellAbortRef.current?.abort();
                }}
                className="w-full rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                className="w-full rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {status.step === "done" ? "Redo captions" : "Make captions"}
              </button>
            ))}
          <SpellStatusLine status={spellStatus} />
          {captions.length > 0 && (
            <p className="text-xs text-zinc-400">Click a caption to edit it · click the time to jump.</p>
          )}
          {captions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
              {!file
                ? "Choose a video to get started."
                : status.step === "done"
                    ? "No speech was detected in this clip. Check that the video's audio has audible speech, then click Redo captions."
                    : "Your captions will appear here once you make them."}
            </p>
          ) : (
            <ol className="flex flex-col gap-1" data-testid="captions">
              {captions.map((c) => {
                const text = c.lines?.join(" ") ?? c.text;
                const edited = captionEdits[c.id] !== undefined;
                const moved = captionPlacements[c.id] !== undefined;
                const sized = captionScales[c.id] !== undefined;
                return (
                  <li key={c.id}>
                    <div
                      className={`flex items-start gap-2 rounded-lg px-2 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                        selectedCaptionId === c.id ? "bg-amber-50 dark:bg-amber-500/10" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCaptionId(c.id);
                          seek(c.start);
                        }}
                        title="Jump to this caption"
                        className="mt-0.5 shrink-0 rounded px-1 font-mono text-xs tabular-nums text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        {clock(c.start)}
                      </button>
                      {editingId === c.id ? (
                        <textarea
                          autoFocus
                          rows={2}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitEdit(c.id, draft)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              commitEdit(c.id, draft);
                            } else if (e.key === "Escape") {
                              setEditingId(null);
                            }
                          }}
                          className="w-full resize-none rounded-lg border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(c.id, text)}
                          title="Click to edit"
                          className="w-full rounded-lg px-2 py-0.5 text-left text-sm"
                        >
                          {text}
                          {edited && (
                            <span className="ml-2 text-[10px] font-medium tracking-wide text-amber-600 uppercase dark:text-amber-400">
                              edited
                            </span>
                          )}
                          {moved && (
                            <span
                              className="ml-2 text-[10px] font-medium tracking-wide text-sky-600 uppercase dark:text-sky-400"
                              title="This caption has its own position"
                            >
                              moved
                            </span>
                          )}
                          {sized && (
                            <span
                              className="ml-2 text-[10px] font-medium tracking-wide text-violet-600 uppercase dark:text-violet-400"
                              title="This caption has its own size"
                            >
                              sized
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>

        {/* Preview */}
        <main className="order-1 flex min-h-0 flex-col gap-3 p-4 lg:order-2">
          {status.step !== "idle" && (
            <div className="flex flex-col gap-2.5" data-testid="progress">
              {(status.step === "extracting" ||
                status.step === "uploading" ||
                status.step === "transcribing") && (
                <ProgressBar value={status.step === "transcribing" ? undefined : status.progress} />
              )}
              <StatusLine status={status} elapsedSec={elapsedSec} />
            </div>
          )}

          {file && videoUrl ? (
            <>
              <CaptionPlayer
                className="min-h-0 flex-1"
                src={videoUrl}
                captions={captions}
                style={settings.style}
                videoRef={videoRef}
                interactive={tab === "style"}
                onPlacement={placeCaption}
                onScale={resizeCaption}
                onSyncSize={syncSize}
                onSyncPlacement={syncPlacement}
              />
              <Timeline
                videoRef={videoRef}
                captions={captions}
                selectedId={selectedCaptionId}
                onSelect={setSelectedCaptionId}
                onRetime={retimeCaption}
                onReset={resetCaptionTiming}
              />
            </>
          ) : (
            <DropZone
              dragOver={dragOver}
              onDragOver={setDragOver}
              onDrop={onDrop}
              onPick={() => fileInputRef.current?.click()}
              title="Video not saved for this project"
              subtitle="Choose the video file again to preview it and export captions."
            />
          )}
        </main>

        {/* Inspector */}
        <aside className="order-3 flex min-h-0 flex-col border-t border-zinc-200 lg:border-t-0 lg:border-l dark:border-zinc-800">
          <div role="tablist" className="flex shrink-0 gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
            <TabButton active={tab === "style"} onClick={() => setTab("style")}>
              Style
            </TabButton>
            <TabButton testId="advanced" active={tab === "settings"} onClick={() => setTab("settings")}>
              Settings
            </TabButton>
          </div>

          <div className={`${tab === "style" ? "flex" : "hidden"} min-h-0 flex-1 flex-col overflow-y-auto`}>
            <StylePicker
              style={settings.style}
              onChange={(style) => setSettings({ ...settings, style })}
              hasPlacements={Object.keys(captionPlacements).length > 0}
              onResetPlacements={resetPlacements}
            />
          </div>

          <div className={`${tab === "settings" ? "flex" : "hidden"} min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 text-sm`}>
            <ApiKeyField value={apiKey} onChange={updateApiKey} />

            <div className="flex flex-col gap-2">
              <span className="font-medium">Language</span>
              <p className="text-xs text-zinc-500" data-testid="detected-language">
                {detected
                  ? `Detected automatically: ${formatLanguage(detected)}`
                  : "Detected automatically from the audio — Hindi, Telugu, English and mixed speech all work."}
              </p>
            </div>

            <label className="flex items-start justify-between gap-3">
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Detect speakers</span>
                <span className="text-xs text-zinc-500">
                  Label who is speaking, so Speaker colours can give each person their own colour. Applies to the next
                  transcription.
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.speakers}
                onChange={(e) => setSettings({ ...settings, speakers: e.target.checked })}
                className="mt-1 h-4 w-4 shrink-0 accent-zinc-900 dark:accent-zinc-100"
              />
            </label>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="font-medium">Glossary (optional)</span>
                <textarea
                  rows={2}
                  className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
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
                  disabled={busy || spellStatus.step === "running" || !hasForeign}
                  onClick={() => void runSpelling(words)}
                  className="w-fit underline disabled:opacity-40"
                >
                  Re-check spelling with this glossary
                </button>
              )}
            </div>

            {extract && audioUrl && (
              <div className="flex flex-col gap-1.5">
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
              <button type="button" className="w-fit underline" onClick={downloadWords}>
                Download words JSON
              </button>
            )}

            {words.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="font-medium">Word timings ({words.length})</span>
                <div className="flex max-h-72 flex-wrap gap-1 overflow-auto" data-testid="words">
                  {displayWords.map((w, i) => (
                    <button
                      type="button"
                      key={i}
                      onClick={() => seek(w.start)}
                      title={`${w.start.toFixed(2)}–${w.end.toFixed(2)} s${w.speaker ? ` · ${w.speaker}` : ""}`}
                      className={`rounded px-1.5 py-0.5 ${
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
              <span className="font-medium">Log</span>
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
        </aside>
      </div>
      ) : (
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10">
          <section className="flex flex-col gap-5">
            <div className="flex flex-col items-start gap-3">
              <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                Local-first · your video never leaves your device
              </span>
              <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Captions for any video
              </h1>
              <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
                Drop in a clip and get accurately transcribed, time-coded captions you can style in seconds. Download
                them as <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900">.srt</code> or{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900">.vtt</code>, or burn them
                straight into an MP4. Past projects are saved in this browser, ready to reopen.
              </p>
            </div>
            <DropZone
              dragOver={dragOver}
              onDragOver={setDragOver}
              onDrop={onDrop}
              onPick={() => fileInputRef.current?.click()}
            />
          </section>

          <ProjectsLibrary
            projects={projects}
            loading={projectsLoading}
            storage={storage}
            onOpen={openProject}
            onDelete={removeProject}
          />
        </main>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function DropZone({
  dragOver,
  onDragOver,
  onDrop,
  onPick,
  title = "Drop a video here, or click to choose",
  subtitle = "MP4, MOV, MKV, WebM, AVI — up to 10 minutes",
}: {
  dragOver: boolean;
  onDragOver: (over: boolean) => void;
  onDrop: (e: DragEvent) => void;
  onPick: () => void;
  /** Headline; the workspace reuses the zone when a project's video wasn't saved. */
  title?: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(true);
      }}
      onDragLeave={() => onDragOver(false)}
      onDrop={onDrop}
      className={`flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 text-center transition ${
        dragOver
          ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
          : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-100/60 dark:border-zinc-700 dark:hover:bg-zinc-900/60"
      }`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm dark:bg-zinc-900">
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
      <span className="text-lg font-medium">{title}</span>
      <span className="text-sm text-zinc-500">{subtitle}</span>
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

/** Where the current project stands: saved in this browser, still saving, or not yet. */
function SaveChip({ state }: { state: SaveState }) {
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : state === "unsaved" ? "Unsaved" : "";
  if (!label) return null;
  const tone =
    state === "error"
      ? "text-red-600 dark:text-red-400"
      : state === "saved"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-zinc-400";
  return (
    <span className={`text-xs tabular-nums ${tone}`} data-testid="save-state" title="Saved in this browser only">
      {label}
    </span>
  );
}

function SpellStatusLine({ status }: { status: SpellStatus }) {
  if (status.step !== "done") return null;
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

function mb(bytes: number) {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
