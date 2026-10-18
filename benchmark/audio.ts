import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Same settings the browser will use (PLAN.md §5): 16 kHz mono Opus, 24 kbps,
 * speech-tuned, in an Ogg container.
 */
export const OPUS_ARGS = ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", "-application", "voip"];

/** Convert `src` to Opus at `dest`, skipping when the cached file is newer. */
export async function toOpus(src: string, dest: string): Promise<{ cached: boolean }> {
  const [s, d] = await Promise.all([stat(src), stat(dest).catch(() => undefined)]);
  if (d && d.mtimeMs >= s.mtimeMs && d.size > 0) return { cached: true };
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, ...OPUS_ARGS, dest]);
  return { cached: false };
}

export async function durationSeconds(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const d = Number(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe could not read duration of ${file}`);
  return d;
}
