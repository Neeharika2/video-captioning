/**
 * Export the original video with captions added as a subtitle track (no
 * re-encode, so it's fast and lossless). Viewers can switch captions on/off in
 * players like VLC, QuickTime, mpv and most TVs. Social apps usually ignore
 * subtitle tracks; use the burned-in export for those.
 *
 * MP4/MOV inputs stay MP4/MOV (mov_text subtitles); anything else becomes MKV
 * (SRT subtitles), which accepts almost any codec. Browser only.
 */
import { toSrt } from "../export/subtitles";
import type { Caption } from "../types";
import { createFfmpeg, mountInput } from "./ffmpeg";

/** ffmpeg.wasm holds the whole output in memory (~2 GB wasm limit). */
export const MAX_EMBED_BYTES = 1.2e9;

export type EmbedResult = { blob: Blob; extension: string };

/** ISO 639-1 → 639-2, for the track's language tag. */
const LANGUAGE_TAGS: Record<string, string> = {
  te: "tel",
  en: "eng",
  hi: "hin",
  ta: "tam",
  kn: "kan",
  ml: "mal",
  bn: "ben",
  mr: "mar",
  gu: "guj",
  pa: "pan",
  ur: "urd",
  or: "ori",
};

function containerFor(file: File): { extension: string; mime: string; codec: string } {
  const ext = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (ext === "mov") return { extension: ".mov", mime: "video/quicktime", codec: "mov_text" };
  if (ext === "mp4" || ext === "m4v" || (!ext && file.type === "video/mp4")) {
    return { extension: ".mp4", mime: "video/mp4", codec: "mov_text" };
  }
  return { extension: ".mkv", mime: "video/x-matroska", codec: "srt" };
}

export async function embedSubtitles(
  file: File,
  captions: Caption[],
  opts: { language?: string; signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<EmbedResult> {
  if (file.size > MAX_EMBED_BYTES) {
    throw new Error(
      `This video is too large (${(file.size / 1e9).toFixed(1)} GB) to add a caption track in the browser. ` +
        "Use the burned-in export or download the .srt instead.",
    );
  }
  const loaded = await createFfmpeg({ signal: opts.signal, onProgress: opts.onProgress });
  const { ffmpeg } = loaded;
  const log: string[] = [];
  ffmpeg.on("log", ({ message }) => {
    log.push(message);
    if (log.length > 30) log.shift();
  });

  try {
    const inputPath = await mountInput(loaded, file);
    await ffmpeg.writeFile("/captions.srt", new TextEncoder().encode(toSrt(captions)));
    const lang = LANGUAGE_TAGS[opts.language?.toLowerCase().split(/[-_]/)[0] ?? ""];

    const run = async (target: ReturnType<typeof containerFor>) => {
      const out = `/out${target.extension}`;
      const code = await ffmpeg.exec([
        "-hide_banner",
        // Keep original timestamps: caption times are on the video's own
        // timeline, and ffmpeg would otherwise shift each input to start at 0.
        "-copyts",
        "-i", inputPath,
        "-i", "/captions.srt",
        "-map", "0:v?", "-map", "0:a?", "-map", "1:0",
        "-c", "copy",
        "-c:s", target.codec,
        "-disposition:s:0", "default",
        "-metadata:s:s:0", "title=Captions",
        ...(lang ? ["-metadata:s:s:0", `language=${lang}`] : []),
        ...(target.extension === ".mkv" ? [] : ["-movflags", "+faststart"]),
        out,
      ]);
      if (code !== 0) return null;
      const data = (await ffmpeg.readFile(out)) as Uint8Array;
      await ffmpeg.deleteFile(out).catch(() => {});
      return { blob: new Blob([data as BlobPart], { type: target.mime }), extension: target.extension };
    };

    const preferred = containerFor(file);
    let result = await run(preferred);
    // Some codecs aren't allowed in MP4/MOV; MKV takes nearly anything.
    if (!result && preferred.extension !== ".mkv") {
      result = await run({ extension: ".mkv", mime: "video/x-matroska", codec: "srt" });
    }
    if (!result) {
      throw new Error(`ffmpeg couldn't add the caption track: ${log.slice(-3).join(" ").trim() || "unknown error"}`);
    }
    return result;
  } finally {
    ffmpeg.terminate();
  }
}
