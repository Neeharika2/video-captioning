/**
 * A small poster frame for a project card.
 *
 * Capturing a frame is best-effort: an unsupported codec, a stalled seek or a
 * slow decoder all resolve to `null`, and the card falls back to a plain
 * placeholder rather than blocking the save. The frame is drawn off-screen (the
 * element is never attached), scaled to a fixed width and encoded as a JPEG data
 * URL small enough to sit inside the IndexedDB record.
 */

export type ThumbnailOptions = {
  /** Output width in pixels; the height follows the video's own aspect ratio. */
  width?: number;
  /** Give up after this long and resolve null. */
  timeoutMs?: number;
};

/** Grab a poster frame from a video Blob, or null if it can't be decoded. */
export async function captureThumbnail(file: Blob, options: ThumbnailOptions = {}): Promise<string | null> {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return null;
  const width = options.width ?? 320;
  const timeoutMs = options.timeoutMs ?? 6000;

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = url;

  try {
    return await withTimeout(captureFrame(video, width), timeoutMs);
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Wait for a decoded frame, nudge the clock a quarter of the way in (so the
 * poster isn't a black lead-in), then paint it to a canvas.
 */
function captureFrame(video: HTMLVideoElement, width: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const draw = () => {
      try {
        const ratio = video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(w * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        finish(null);
      }
    };

    const onSeeked = () => draw();
    const onLoaded = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = duration > 0 ? Math.min(1, duration * 0.25) : 0;
      if (target <= 0.01) {
        draw();
        return;
      }
      try {
        video.currentTime = target;
      } catch {
        draw();
      }
    };
    const onError = () => finish(null);

    video.addEventListener("loadeddata", onLoaded, { once: true });
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

/** Resolve with the promise's value, or null if it takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
