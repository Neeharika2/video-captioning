/**
 * Shared ffmpeg.wasm loader (browser only).
 *
 * @ffmpeg/ffmpeg is served from public/ffmpeg/esm and imported at runtime
 * instead of bundled: Turbopack can't resolve its worker URL. See
 * scripts/copy-ffmpeg-core.mjs.
 */
import type { FFmpeg } from "@ffmpeg/ffmpeg";

type FfmpegModule = typeof import("@ffmpeg/ffmpeg");

const BASE = "/ffmpeg";

async function loadModule(): Promise<FfmpegModule> {
  const url = `${window.location.origin}${BASE}/esm/index.js`;
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}

export type LoadedFfmpeg = {
  ffmpeg: FFmpeg;
  FFFSType: FfmpegModule["FFFSType"];
  /** Duration and start time parsed from ffmpeg's log for the first input. */
  media: { durationSec: number; startSec: number };
};

/**
 * Start a fresh ffmpeg worker. Call `ffmpeg.terminate()` when done; aborting
 * `signal` terminates it too.
 */
export async function createFfmpeg(opts: {
  signal?: AbortSignal;
  /** 0..1, based on output time vs. input duration. */
  onProgress?: (fraction: number) => void;
}): Promise<LoadedFfmpeg> {
  const { FFmpeg, FFFSType } = await loadModule();
  const ffmpeg = new FFmpeg();
  const media = { durationSec: 0, startSec: 0 };

  ffmpeg.on("log", ({ message }) => {
    // "  Duration: 00:01:23.45, start: 0.021333, bitrate: ..."
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)(?:,\s*start:\s*(-?\d+(?:\.\d+)?))?/.exec(message);
    if (m && !media.durationSec) {
      media.durationSec = +m[1] * 3600 + +m[2] * 60 + +m[3];
      media.startSec = m[4] ? Math.max(0, +m[4]) : 0;
    }
  });
  ffmpeg.on("progress", ({ time }) => {
    // `time` is output time in microseconds.
    if (media.durationSec > 0) opts.onProgress?.(Math.min(1, Math.max(0, time / 1e6 / media.durationSec)));
  });

  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  opts.signal?.addEventListener("abort", () => ffmpeg.terminate(), { once: true });

  const origin = window.location.origin;
  await ffmpeg.load({ coreURL: `${origin}${BASE}/ffmpeg-core.js`, wasmURL: `${origin}${BASE}/ffmpeg-core.wasm` });
  return { ffmpeg, FFFSType, media };
}

/** Mount a File read-only (WORKERFS: no copy into wasm memory). Returns its path. */
export async function mountInput(loaded: LoadedFfmpeg, file: File, dir = "/input"): Promise<string> {
  await loaded.ffmpeg.createDir(dir);
  await loaded.ffmpeg.mount(loaded.FFFSType.WORKERFS, { files: [file] }, dir);
  return `${dir}/${file.name}`;
}
