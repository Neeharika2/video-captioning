/**
 * Browser-only: pull the audio out of a local video file and encode it in the
 * upload format (Ogg Opus, mono, ~24 kbps). The video never leaves the device.
 *
 * Engine 1: Mediabunny (WebCodecs) — streams the file, uses hardware decoders.
 * Engine 2: ffmpeg.wasm fallback for containers/codecs the browser can't decode.
 */
export type ExtractEngine = "mediabunny" | "ffmpeg";

export type ExtractResult = {
  audio: Blob;
  durationSec: number;
  /**
   * Where the audio starts on the video timeline, in seconds. Add this to
   * transcript times so captions line up with `video.currentTime`.
   */
  startOffsetSec: number;
  engine: ExtractEngine;
  elapsedMs: number;
  /** Why the first engine was skipped, if it was. */
  fallbackReason?: string;
};

export type ExtractOptions = {
  onProgress?: (fraction: number, engine: ExtractEngine) => void;
  signal?: AbortSignal;
  /** Force an engine (for testing/comparison). */
  engine?: ExtractEngine;
};

export class NoAudioTrackError extends Error {
  constructor() {
    super("This video has no audio track.");
    this.name = "NoAudioTrackError";
  }
}

export const OPUS_BITRATE = 24_000;
export const OPUS_SAMPLE_RATE = 16_000;

export async function extractAudio(file: File, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const started = performance.now();
  if (opts.engine === "ffmpeg") return finish(await extractWithFfmpeg(file, opts), started);

  try {
    return finish(await extractWithMediabunny(file, opts), started);
  } catch (err) {
    if (opts.signal?.aborted || err instanceof NoAudioTrackError || opts.engine === "mediabunny") throw err;
    const fallbackReason = (err as Error).message;
    console.warn("[extract] Mediabunny failed, falling back to ffmpeg.wasm:", fallbackReason);
    return { ...finish(await extractWithFfmpeg(file, opts), started), fallbackReason };
  }
}

type EngineResult = Omit<ExtractResult, "elapsedMs" | "fallbackReason">;

function finish(r: EngineResult, started: number): ExtractResult {
  return { ...r, elapsedMs: Math.round(performance.now() - started) };
}

// ---------------------------------------------------------------------------

async function extractWithMediabunny(file: File, opts: ExtractOptions): Promise<EngineResult> {
  const mb = await import("mediabunny");
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new NoAudioTrackError();

    const quality = new mb.Quality({ bitrate: OPUS_BITRATE });
    // Opus encoders don't all accept 16 kHz; 48 kHz at the same bitrate is fine.
    let sampleRate = OPUS_SAMPLE_RATE;
    if (!(await mb.canEncodeAudio("opus", { numberOfChannels: 1, sampleRate, quality }))) {
      sampleRate = 48_000;
      if (!(await mb.canEncodeAudio("opus", { numberOfChannels: 1, sampleRate, quality }))) {
        throw new Error("This browser cannot encode Opus audio");
      }
    }

    const output = new mb.Output({ format: new mb.OggOutputFormat(), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { discard: true },
      audio: { codec: "opus", numberOfChannels: 1, sampleRate, quality, forceTranscode: true },
      showWarnings: false,
    });
    if (!conversion.isValid || !conversion.utilizedTracks.length) {
      const reasons = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(", ");
      throw new Error(`Cannot convert audio (${reasons || "no usable track"})`);
    }

    const onAbort = () => void conversion.cancel();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    conversion.onProgress = (p) => opts.onProgress?.(p, "mediabunny");
    try {
      await conversion.execute();
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }

    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Conversion produced no output");
    const startOffsetSec = Math.max(0, await track.getFirstTimestamp());
    const durationSec = await track.computeDuration();
    return {
      audio: new Blob([buffer], { type: "audio/ogg" }),
      durationSec: Math.max(0, durationSec - startOffsetSec),
      startOffsetSec,
      engine: "mediabunny",
    };
  } finally {
    input.dispose();
  }
}

// ---------------------------------------------------------------------------

async function extractWithFfmpeg(file: File, opts: ExtractOptions): Promise<EngineResult> {
  const { createFfmpeg, mountInput } = await import("./ffmpeg");
  const loaded = await createFfmpeg({
    signal: opts.signal,
    onProgress: (p) => opts.onProgress?.(p, "ffmpeg"),
  });
  const { ffmpeg, media } = loaded;
  try {
    const inputPath = await mountInput(loaded, file);
    const code = await ffmpeg.exec([
      "-hide_banner",
      "-i", inputPath,
      "-map", "0:a:0",
      "-vn", "-ac", "1", "-ar", String(OPUS_SAMPLE_RATE),
      "-c:a", "libopus", "-b:a", "24k", "-application", "voip",
      "/out.ogg",
    ]);
    if (code !== 0) {
      throw new Error(code === 1 && media.durationSec ? "ffmpeg could not find an audio track" : `ffmpeg exited with code ${code}`);
    }
    const data = (await ffmpeg.readFile("/out.ogg")) as Uint8Array;
    return {
      audio: new Blob([data as BlobPart], { type: "audio/ogg" }),
      durationSec: media.durationSec,
      startOffsetSec: media.startSec,
      engine: "ffmpeg",
    };
  } finally {
    ffmpeg.terminate();
  }
}
