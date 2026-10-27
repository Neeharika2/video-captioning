/**
 * "Punchline pick": a text-only Gemini pass that reads each caption and names
 * the word(s) that carry the emphasis — the word a caption designer would put
 * on its own line, bigger (see `punchlineIndices` and the preset lockups).
 *
 * Captions are short groups of consecutive spoken words, numbered from 0. Word
 * timings and text must never move, so the model only returns indices into the
 * caption it was given. Everything it returns is checked here; a caption whose
 * answer fails a check falls back to the local pick (`pickKeywords`).
 *
 * Shared by the server (prompt + checks) and the client (request types).
 */
import { z } from "zod";

export const PUNCHLINE_PATH = "/api/punchlines";
/** Captions analysed per request. Long transcripts are sent in batches. */
export const MAX_PUNCHLINE_CAPTIONS = 60;
/** Neighbouring captions sent as read-only context on each side of a batch. */
export const PUNCHLINE_CONTEXT_CAPTIONS = 4;
/** A caption is at most this many words (the app groups 1–4 per cue). */
export const MAX_CAPTION_WORDS = 12;
/** Most words the model may call the punchline in one caption. */
export const MAX_PUNCHLINE_WORDS = 3;
const MAX_WORD_LENGTH = 100;

const caption = z.array(z.string().max(MAX_WORD_LENGTH)).min(1).max(MAX_CAPTION_WORDS);

export const PunchlineRequestSchema = z.object({
  /** The captions to analyse; a caption's ID is its index here. */
  captions: z.array(caption).min(1).max(MAX_PUNCHLINE_CAPTIONS),
  /** Read-only context: the captions just before and after this batch. */
  before: z.array(caption).max(PUNCHLINE_CONTEXT_CAPTIONS).optional(),
  after: z.array(caption).max(PUNCHLINE_CONTEXT_CAPTIONS).optional(),
});
export type PunchlineRequest = z.infer<typeof PunchlineRequestSchema>;

export type PunchlinePick = {
  /** 0-based indices of the punchline word(s), ascending. */
  words: number[];
};

export type PunchlineResponse = {
  /** One entry per request caption; null = rejected, use the local pick. */
  punchlines: (number[] | null)[];
  rejected: number;
  model: string;
};

// ---------------------------------------------------------------------------
// Prompt

export const PUNCHLINE_SYSTEM_PROMPT = `You pick the punchline word(s) in short video captions. Each caption is a group of consecutive spoken words, numbered from 0. Captions come from a transcript and may be in any language (for example Telugu, Hindi, Tamil, Arabic, Russian, English), written in either the original script or in English letters.

For EVERY caption ID you are given, return exactly one item with that same ID, in the same order, and a "words" array holding the 0-based indices of the punchline word(s) in that caption.

The punchline is the word a caption designer would put on its own line, bigger: the word that carries the emphasis, the surprise, the number, the name, or the point of the line (for example "free", "5000", "tonight", "sold out", "never").

Rules:
1. Pick one word in most captions. Pick two only when the line clearly has two equally important words (a name plus a number, or a short fixed phrase). Never pick more than three, and never pick every word.
2. Only return indices that exist in that caption. Never invent, merge or reorder words.
3. Prefer content words — nouns, verbs, adjectives, numbers, names — over filler words ("the", "a", "is", "and", "of", "to", "um"). Never pick a word that is only punctuation.
4. If a caption is a single word, return that word's index (0).
5. Indices are counted from 0 within each caption, not across the whole transcript.

Some captions name a number, a price, a date or a superlative ("best", "worst", "biggest"); those are almost always the punchline.`;

export function buildPunchlinePrompt(req: PunchlineRequest): string {
  const fmt = (words: string[]) => words.map((w, i) => `${i}:${w}`).join(" ");
  const lines: string[] = [];
  if (req.before?.length) lines.push(`Context before (do not return): ${req.before.map(fmt).join(" | ")}`);
  lines.push("Captions (id<TAB>index:word …):");
  req.captions.forEach((words, id) => lines.push(`${id}\t${fmt(words)}`));
  if (req.after?.length) lines.push(`Context after (do not return): ${req.after.map(fmt).join(" | ")}`);
  lines.push("", `Return all ${req.captions.length} IDs, 0 to ${req.captions.length - 1}.`);
  return lines.join("\n");
}

/** JSON Schema for Gemini structured output. */
export const PUNCHLINE_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    punchlines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          words: { type: "array", items: { type: "integer" } },
        },
        required: ["id", "words"],
      },
    },
  },
  required: ["punchlines"],
} as const;

export const ModelPunchlineOutputSchema = z.object({
  punchlines: z.array(z.looseObject({ id: z.unknown(), words: z.unknown() })),
});

// ---------------------------------------------------------------------------
// Checks

export type PunchlineRejectReason =
  | "missing"
  | "duplicate"
  | "out_of_order"
  | "empty"
  | "out_of_range"
  | "too_many";

export type PunchlineReconciled = {
  punchlines: (number[] | null)[];
  rejections: { id: number; reason: PunchlineRejectReason }[];
};

/**
 * Check the model's answer against the request, caption by caption. Returns
 * ascending indices per input caption, or null where the answer can't be
 * trusted (the client keeps its local pick there).
 */
export function reconcilePunchlines(input: string[][], output: unknown): PunchlineReconciled {
  const n = input.length;
  const rejections = new Map<number, PunchlineRejectReason>();
  const reject = (id: number, reason: PunchlineRejectReason) => {
    if (id >= 0 && id < n && !rejections.has(id)) rejections.set(id, reason);
  };

  const parsed = ModelPunchlineOutputSchema.safeParse(output);
  const items = parsed.success ? parsed.data.punchlines : [];

  // Structure: every ID once, in order.
  const byId = new Map<number, unknown>();
  const seen = new Set<number>();
  let prev = -1;
  for (const item of items) {
    const id = item.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id >= n) continue;
    if (seen.has(id)) {
      byId.delete(id);
      reject(id, "duplicate");
      continue;
    }
    seen.add(id);
    if (id <= prev) {
      reject(id, "out_of_order");
      continue;
    }
    prev = id;
    byId.set(id, item.words);
  }
  for (let id = 0; id < n; id++) if (!seen.has(id)) reject(id, "missing");

  const punchlines = input.map((words, id): number[] | null => {
    if (rejections.has(id)) return null;
    const raw = byId.get(id);
    if (!Array.isArray(raw)) return reject(id, "missing"), null;

    const picked = new Set<number>();
    for (const value of raw) {
      // Out-of-range indices mean a confused answer; drop the whole caption.
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= words.length) {
        return reject(id, "out_of_range"), null;
      }
      picked.add(value);
    }
    if (!picked.size) return reject(id, "empty"), null;
    if (picked.size > MAX_PUNCHLINE_WORDS) return reject(id, "too_many"), null;
    return [...picked].sort((a, b) => a - b);
  });

  return { punchlines, rejections: [...rejections].map(([id, reason]) => ({ id, reason })) };
}
