/**
 * One `requestAnimationFrame` loop shared by every animated preview on the page.
 * The preset gallery can show a dozen live miniatures at once; giving each its
 * own loop would mean a dozen rAF callbacks per frame, so they subscribe to this
 * single ticker instead. The loop starts on the first subscriber and stops
 * itself when the last one leaves.
 */
type FrameCallback = (now: number) => void;

const callbacks = new Set<FrameCallback>();
let frame = 0;

function tick(now: number) {
  frame = 0;
  for (const cb of callbacks) cb(now);
  if (callbacks.size > 0) frame = requestAnimationFrame(tick);
}

/**
 * Run `cb` on every animation frame until the returned function is called. Safe
 * to subscribe/unsubscribe as elements scroll in and out of view.
 */
export function subscribeFrame(cb: FrameCallback): () => void {
  callbacks.add(cb);
  if (frame === 0) frame = requestAnimationFrame(tick);
  return () => {
    callbacks.delete(cb);
  };
}
