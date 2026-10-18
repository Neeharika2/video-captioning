/**
 * Export the video with captions drawn into the picture (always visible, in
 * any player). Browser only.
 *
 * Mediabunny decodes each frame with WebCodecs, we draw the caption showing at
 * that frame's timestamp on a canvas, and it re-encodes (hardware where
 * available). Audio is copied unchanged when the container allows it.
 */
import { styleForCaption, type CaptionStyle } from "../caption-style";
import type { Caption } from "../types";
import { drawCaption, findCaptionAt, spokenWordAt } from "./caption-renderer";
import type { SaveTarget } from "./save-file";

export type BurnInOptions = {
  /** Look of the burned-in captions; also drives the browser preview. */
  style: CaptionStyle;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export type BurnInResult = {
  /** Present when the target was "download" (the caller saves it). */
  blob?: Blob;
  warnings: string[];
};

export async function burnInCaptions(
  file: File,
  captions: Caption[],
  target: SaveTarget,
  opts: BurnInOptions,
): Promise<BurnInResult> {
  const mb = await import("mediabunny");
  const sorted = [...captions].sort((a, b) => a.start - b.start);
  const warnings: string[] = [];
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("This file has no video track to draw captions on.");
    const width = videoTrack.displayWidth;
    const height = videoTrack.displayHeight;

    const quality = new mb.Quality("high");
    const codec = await mb.getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width, height, quality });
    if (!codec) throw new Error("This browser can't encode video at this size. Try Chrome or Edge.");

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: target.kind === "disk" ? false : "in-memory" }),
      target:
        target.kind === "disk"
          ? new mb.StreamTarget(target.writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>)
          : new mb.BufferTarget(),
    });

    let canvas: OffscreenCanvas | undefined;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;

    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec,
        quality,
        forceTranscode: true,
        // Bake rotation into the pixels so captions sit at the visual bottom.
        allowTransformationMetadata: false,
        process: (sample) => {
          if (!canvas || canvas.width !== sample.displayWidth || canvas.height !== sample.displayHeight) {
            canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
            ctx = canvas.getContext("2d");
          }
          if (!ctx) throw new Error("Canvas 2D is not available");
          sample.draw(ctx, 0, 0, canvas.width, canvas.height);
          // Caption times are on the video timeline, same as frame timestamps.
          const i = findCaptionAt(sorted, sample.timestamp);
          if (i >= 0) {
            const t = sample.timestamp;
            const cue = sorted[i];
            const word = opts.style.emphasis === "highlight" ? spokenWordAt(cue, t) : -1;
            // Per-cue placement + appearance animation, exactly as in the preview.
            drawCaption(ctx, cue, canvas.width, canvas.height, styleForCaption(opts.style, cue.placement), word, t - cue.start);
          }
          return canvas;
        },
      },
      audio: {},
      showWarnings: false,
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(", ");
      throw new Error(`Can't export this video (${reasons})`);
    }
    for (const d of conversion.discardedTracks) {
      if (d.track.type === "audio" && d.reason !== "discarded_by_user") {
        warnings.push(`The audio couldn't be kept (${d.reason}); the exported video is silent.`);
      }
    }

    const onAbort = () => void conversion.cancel();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    conversion.onProgress = (p) => opts.onProgress?.(p);
    try {
      await conversion.execute();
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
    // Never keep a half-written file after Cancel.
    if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

    if (target.kind === "disk") {
      await closeQuietly(target.writable);
      return { warnings };
    }
    const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buffer) throw new Error("Export produced no output");
    return { blob: new Blob([buffer], { type: "video/mp4" }), warnings };
  } catch (err) {
    if (target.kind === "disk") await target.writable.abort().catch(() => {});
    throw err;
  } finally {
    input.dispose();
  }
}

/** Mediabunny may already have closed the stream on finalize. */
async function closeQuietly(writable: FileSystemWritableFileStream) {
  try {
    await writable.close();
  } catch {
    /* already closed */
  }
}
