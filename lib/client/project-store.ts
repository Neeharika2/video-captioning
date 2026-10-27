/**
 * Past captions, kept in this browser only (the app is local-first). A project
 * holds the transcript, the captions and every edit made to them; the source
 * video is stored alongside it when it fits the browser's storage quota, and the
 * project is kept either way — a project whose video was too big is marked
 * "video not saved" and can be reopened to re-attach the file.
 *
 * Two object stores in one database (`vc-projects`, version 1):
 *   projects — one record per project: everything except the video bytes.
 *   videos   — one record per project that still has its video: id → Blob.
 *
 * Listing the library reads `projects` only, so the grid never pays to load the
 * video bytes. Every function that touches IndexedDB does so inside its own
 * body, so this module can be imported under `node` (see the unit tests, which
 * only exercise the pure helpers below).
 */
import type { TranscribeResponse } from "@/lib/api-types";
import type { CaptionPlacement, CaptionStyle } from "@/lib/caption-style";
import type { SpelledWord } from "@/lib/spelling";
import type { Word } from "@/lib/types";

export const DB_NAME = "vc-projects";
export const DB_VERSION = 1;
export const PROJECTS_STORE = "projects";
export const VIDEOS_STORE = "videos";

/** Non-English speech can be shown in English letters ("roman") or its own script. */
export type SavedScript = "roman" | "original";

/** Everything about the editor's own settings that is worth restoring. */
export type SavedSettings = {
  style: CaptionStyle;
  script: SavedScript;
  /** Terms to spell exactly, comma or newline separated. */
  glossary: string;
  /** Whether transcription was asked for speaker labels. */
  speakers: boolean;
};

/** A saved project: the transcript and every edit, minus the video bytes. */
export type SavedProject = {
  id: string;
  /** Source file name, shown on the card and reused when rebuilding the File. */
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Size of the source video in bytes (0 when there was no video). */
  bytes: number;
  /** MIME type of the source video, so a File can be rebuilt from the Blob. */
  mimeType: string;
  /** Video length in seconds, when known. */
  durationSec?: number;
  /** A small JPEG data URL for the library card. */
  thumbnail?: string;
  /** True while the video Blob is still in the `videos` store. */
  hasVideo: boolean;
  settings: SavedSettings;
  words: Word[];
  spelled: (SpelledWord | null)[] | null;
  result: TranscribeResponse | null;
  punchlines: Record<string, number[]>;
  captionEdits: Record<string, string>;
  captionTimings: Record<string, { start: number; end: number }>;
  captionPlacements: Record<string, CaptionPlacement>;
  captionScales: Record<string, number>;
};

/** The light record the library grid renders: a project without its transcript. */
export type ProjectSummary = Pick<
  SavedProject,
  "id" | "name" | "createdAt" | "updatedAt" | "bytes" | "durationSec" | "thumbnail" | "hasVideo"
> & { wordCount: number };

export type StorageEstimate = { usage: number; quota: number };

// ---------------------------------------------------------------------------
// Pure helpers (no browser APIs — unit-tested under node)

/** Strip a project down to what the library card needs. */
export function toSummary(project: SavedProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    bytes: project.bytes,
    durationSec: project.durationSec,
    thumbnail: project.thumbnail,
    hasVideo: project.hasVideo,
    wordCount: project.words.length,
  };
}

/** Newest edit first, so the most recent project is always on top. */
export function sortProjects(summaries: ProjectSummary[]): ProjectSummary[] {
  return [...summaries].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** "1.4 MB", "820 KB", "12 B" — for the storage read-out and project cards. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  const digits = i === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[i]}`;
}

/** "0:42", "3:07", or "" when the length is unknown. */
export function formatDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return "";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m > 0 ? `${m}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}

/** A collision-proof project id, with a fallback for old browsers. */
export function newProjectId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing

/** Whether this browser can persist projects at all (e.g. private mode can't). */
export function projectStoreAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function fromRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (once) the projects database, creating the stores on first run. */
export function openProjectDb(): Promise<IDBDatabase> {
  if (!projectStoreAvailable()) return Promise.reject(new Error("IndexedDB is unavailable in this browser"));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(VIDEOS_STORE)) db.createObjectStore(VIDEOS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the projects database"));
    req.onblocked = () => reject(new Error("Another tab is holding an older version of the database"));
  });
  return dbPromise;
}

/** Every project, newest first. Never rejects: an unavailable store reads empty. */
export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const db = await openProjectDb();
    const tx = db.transaction(PROJECTS_STORE, "readonly");
    const all = await fromRequest<SavedProject[]>(tx.objectStore(PROJECTS_STORE).getAll());
    await txDone(tx);
    return sortProjects(all.map(toSummary));
  } catch {
    return [];
  }
}

/** One full project (transcript included), or null. */
export async function getProject(id: string): Promise<SavedProject | null> {
  try {
    const db = await openProjectDb();
    const tx = db.transaction(PROJECTS_STORE, "readonly");
    const found = await fromRequest<SavedProject | undefined>(tx.objectStore(PROJECTS_STORE).get(id));
    await txDone(tx);
    return found ?? null;
  } catch {
    return null;
  }
}

/** The stored video Blob for a project, or null when it wasn't kept. */
export async function getVideo(id: string): Promise<Blob | null> {
  try {
    const db = await openProjectDb();
    const tx = db.transaction(VIDEOS_STORE, "readonly");
    const found = await fromRequest<Blob | undefined>(tx.objectStore(VIDEOS_STORE).get(id));
    await txDone(tx);
    return found ?? null;
  } catch {
    return null;
  }
}

export type SaveResult = {
  ok: boolean;
  /** Whether the video Blob ended up stored (false if there was none, or it was too big). */
  videoStored: boolean;
  error?: string;
};

/**
 * Write a project. Pass the video Blob the first time (and whenever it was
 * missing) to store it too. A project's edits are cheap, but a video can blow
 * the quota: when that happens the video is dropped and the project is written
 * again on its own, so the transcript is never lost.
 */
export async function saveProject(project: SavedProject, video?: Blob | null): Promise<SaveResult> {
  const withVideo = Boolean(video);
  const hasVideo = withVideo ? true : project.hasVideo;
  try {
    const db = await openProjectDb();
    const tx = db.transaction([PROJECTS_STORE, VIDEOS_STORE], "readwrite");
    const videos = tx.objectStore(VIDEOS_STORE);
    if (video) videos.put(video, project.id);
    // No new video and the project no longer claims one: clear any stale blob.
    else if (!project.hasVideo) videos.delete(project.id);
    tx.objectStore(PROJECTS_STORE).put({ ...project, hasVideo });
    await txDone(tx);
    return { ok: true, videoStored: hasVideo };
  } catch (err) {
    if (!withVideo) return { ok: false, videoStored: false, error: (err as Error).message };
    // Quota (or another write failure) with the video in hand: keep the project.
    try {
      const db = await openProjectDb();
      const tx = db.transaction([PROJECTS_STORE, VIDEOS_STORE], "readwrite");
      tx.objectStore(VIDEOS_STORE).delete(project.id);
      tx.objectStore(PROJECTS_STORE).put({ ...project, hasVideo: false });
      await txDone(tx);
      return { ok: true, videoStored: false, error: (err as Error).message };
    } catch (fallbackErr) {
      return { ok: false, videoStored: false, error: (fallbackErr as Error).message };
    }
  }
}

/** Forget a project and its video. */
export async function deleteProject(id: string): Promise<void> {
  try {
    const db = await openProjectDb();
    const tx = db.transaction([PROJECTS_STORE, VIDEOS_STORE], "readwrite");
    tx.objectStore(PROJECTS_STORE).delete(id);
    tx.objectStore(VIDEOS_STORE).delete(id);
    await txDone(tx);
  } catch {
    /* nothing to delete, or the store is unavailable */
  }
}

/** How much of the browser's quota this origin is using. */
export async function storageEstimate(): Promise<StorageEstimate | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/**
 * Ask the browser to keep this origin's data from being evicted (cleared under
 * storage pressure). Best-effort: browsers may refuse, especially without a
 * user gesture.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
