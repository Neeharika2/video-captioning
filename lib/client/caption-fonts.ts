/**
 * Make sure a caption's self-hosted face is ready before we measure text or
 * draw it on a canvas. The faces are fetched on demand, so without this the
 * canvas can measure a frame before the face swaps in and wrap lines
 * differently from the preview. A short timeout keeps a slow or blocked download
 * from stalling the editor or the export — the browser fallback is used instead.
 */
import { FONT_STACKS, type FontFamily } from "@/lib/caption-style";

const FONT_TIMEOUT_MS = 3000;

/** Resolve once the given caption font can be drawn (or the timeout elapses). */
export async function ensureCaptionFont(family: FontFamily, weight: number): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const stack = FONT_STACKS[family];
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS));
  try {
    // Ask for the requested weight and the regular cut: single-weight display
    // faces only ship 400, and the browser synthesises the rest.
    await Promise.race([
      Promise.all([document.fonts.load(`${weight} 64px ${stack}`), document.fonts.load(`400 64px ${stack}`)]),
      timeout,
    ]);
  } catch {
    // A failed face just falls back; measuring and drawing still work.
  }
}
