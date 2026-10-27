/**
 * One-click looks, grouped by what the accent does rather than by mood:
 *
 * - **Punchline** — a base line with the caption's punchline word on its own
 *   line in a second face (`layout: "lockup"` / `"stack"`, `emphasisTarget:
 *   "keyword"`). Where to grow first.
 * - **Spoken** — the accent follows the word being spoken.
 * - **Block** — the whole caption is styled; no word-level highlight.
 * - **Languages & speakers** — bilingual and multi-speaker looks.
 *
 * Every preset is a combination of the same axes, so any of them can still be
 * fine-tuned in the inspector. The punchline word itself is chosen per caption
 * (see `punchlineIndices`), not toggled by the user.
 */
import type { Preset, PresetCategory } from "../caption-style";
import { PUNCHLINE_PRESETS } from "./punchline";
import { SPOKEN_PRESETS } from "./spoken";
import { BLOCK_PRESETS } from "./block";
import { LANGUAGE_PRESETS } from "./language";

export { definePreset } from "./define-preset";
export type { Preset, PresetId, PresetCategory } from "../caption-style";

/** Gallery sections, in display order. */
export const PRESET_CATEGORIES: { id: PresetCategory; label: string }[] = [
  { id: "punchline", label: "Punchline" },
  { id: "spoken", label: "Follow the speech" },
  { id: "block", label: "Block looks" },
  { id: "language", label: "Languages & speakers" },
];

export const PRESETS: Preset[] = [
  ...PUNCHLINE_PRESETS,
  ...SPOKEN_PRESETS,
  ...BLOCK_PRESETS,
  ...LANGUAGE_PRESETS,
];
