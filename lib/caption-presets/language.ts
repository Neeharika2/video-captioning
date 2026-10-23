import { definePreset } from "./define-preset";

/** The multi-script and multi-speaker looks the reference has no equivalent for. */
export const LANGUAGE_PRESETS = [
  definePreset("bilingual", "language", "Bilingual", "The other script underneath — Telugu with English letters, or the reverse.", {
    fontFamily: "poppins",
    weight: 700,
    scale: 0.046,
    emphasis: "color",
    bilingual: true,
  }),
  definePreset("speaker-duo", "language", "Speaker Duo", "Each speaker gets their own colour — podcasts, interviews (turn on Detect speakers).", {
    fontFamily: "bowlbyOne",
    weight: 400,
    scale: 0.046,
    highlightColor: "#67e8f9",
    speakerColors: true,
    animation: "pop",
  }),
];
