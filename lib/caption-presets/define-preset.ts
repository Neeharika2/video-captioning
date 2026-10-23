import { BASE, type CaptionStyle, type Preset, type PresetCategory, type PresetId } from "../caption-style";

/**
 * Build one preset: the shared `BASE` plus only the axes that make it different,
 * so each preset spells out just its own character. Every preset is a
 * combination of the same axes, so any of them can still be fine-tuned in the
 * inspector. See `PLAN.presets.md` §6.0.
 */
export function definePreset(
  id: PresetId,
  category: PresetCategory,
  name: string,
  description: string,
  style: Partial<CaptionStyle> & Pick<CaptionStyle, "fontFamily">,
): Preset {
  return { id, name, description, category, style: { ...BASE, ...style } };
}
