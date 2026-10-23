/**
 * One-click looks spanning the common short-form aesthetics. Only some follow
 * the spoken word: others change how much text is on screen, which words stand
 * out, the lettering itself, or add a second script or speaker colours. Every
 * preset is a combination of the same axes, so any of them can be fine-tuned.
 *
 * One declarative module per gallery section (PLAN.presets.md §6.0); the shared
 * `definePreset` helper and `BASE` live in `./define-preset` and
 * `../caption-style`.
 */
import type { Preset, PresetCategory } from "../caption-style";
import { CLEAN_PRESETS } from "./clean";
import { HIGHLIGHT_PRESETS } from "./highlight";
import { PUNCHY_PRESETS } from "./punchy";
import { STYLISED_PRESETS } from "./stylised";
import { LANGUAGE_PRESETS } from "./language";

export { definePreset } from "./define-preset";
export type { Preset, PresetId, PresetCategory } from "../caption-style";

/** Gallery sections, in display order. */
export const PRESET_CATEGORIES: { id: PresetCategory; label: string }[] = [
  { id: "clean", label: "Clean & calm" },
  { id: "highlight", label: "Follow the speech" },
  { id: "punchy", label: "Bold & punchy" },
  { id: "stylised", label: "Stylised" },
  { id: "language", label: "Languages & speakers" },
];

export const PRESETS: Preset[] = [
  ...CLEAN_PRESETS,
  ...HIGHLIGHT_PRESETS,
  ...PUNCHY_PRESETS,
  ...STYLISED_PRESETS,
  ...LANGUAGE_PRESETS,
];
