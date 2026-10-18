/**
 * Minimum-edit-distance alignment of two sequences with a full backtrace.
 * Used for WER/timing metrics and (later) two-pass text/timing alignment.
 *
 * Memory is O(n·m) bytes for the backtrace; fine for ≤10 min chunks
 * (~1.5k words each side ≈ 2 MB).
 */
export type AlignOp<A, B> =
  | { op: "match"; a: A; b: B; ai: number; bi: number }
  | { op: "sub"; a: A; b: B; ai: number; bi: number }
  /** In `a` only (deletion from a's point of view). */
  | { op: "del"; a: A; ai: number }
  /** In `b` only (insertion). */
  | { op: "ins"; b: B; bi: number };

const DIAG = 0;
const UP = 1; // consume a[i] (deletion)
const LEFT = 2; // consume b[j] (insertion)

export function alignSequences<A, B>(
  a: readonly A[],
  b: readonly B[],
  equals: (x: A, y: B) => boolean,
): AlignOp<A, B>[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const back = new Uint8Array((n + 1) * width);
  let prev = new Uint32Array(width);
  let curr = new Uint32Array(width);

  for (let j = 0; j <= m; j++) {
    prev[j] = j;
    back[j] = LEFT;
  }
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    back[i * width] = UP;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + (equals(a[i - 1], b[j - 1]) ? 0 : 1);
      const up = prev[j] + 1;
      const left = curr[j - 1] + 1;
      // Prefer diagonal on ties so substitutions pair words up.
      if (diag <= up && diag <= left) {
        curr[j] = diag;
        back[i * width + j] = DIAG;
      } else if (up <= left) {
        curr[j] = up;
        back[i * width + j] = UP;
      } else {
        curr[j] = left;
        back[i * width + j] = LEFT;
      }
    }
    [prev, curr] = [curr, prev];
  }

  const ops: AlignOp<A, B>[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = i === 0 ? LEFT : j === 0 ? UP : back[i * width + j];
    if (dir === DIAG) {
      const ai = i - 1;
      const bi = j - 1;
      const op = equals(a[ai], b[bi]) ? "match" : "sub";
      ops.push({ op, a: a[ai], b: b[bi], ai, bi });
      i--;
      j--;
    } else if (dir === UP) {
      ops.push({ op: "del", a: a[i - 1], ai: i - 1 });
      i--;
    } else {
      ops.push({ op: "ins", b: b[j - 1], bi: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

export function countEdits(ops: readonly AlignOp<unknown, unknown>[]) {
  let sub = 0;
  let del = 0;
  let ins = 0;
  let match = 0;
  for (const o of ops) {
    if (o.op === "sub") sub++;
    else if (o.op === "del") del++;
    else if (o.op === "ins") ins++;
    else match++;
  }
  return { match, sub, del, ins, edits: sub + del + ins };
}
