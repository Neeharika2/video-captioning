import { definePreset } from "./define-preset";

/** Calm, readable looks for everyday talking heads. */
export const CLEAN_PRESETS = [
  definePreset("classic-reels", "clean", "Classic Reels", "White bold text with a soft shadow — everyday reels, talking heads.", {
    fontFamily: "righteous",
    scale: 0.044,
  }),
  definePreset("podcast-clean", "clean", "Podcast Clean", "Calm white text that brightens word by word as it's spoken — interviews.", {
    fontFamily: "syne",
    weight: 500,
    scale: 0.042,
    dimUpcoming: true,
  }),
  definePreset("weight-shift", "clean", "Weight Shift", "Quiet lowercase, one colour; each word turns from light to bold as it's said.", {
    fontFamily: "montserrat",
    weight: 300,
    scale: 0.046,
    emphasis: "weight",
    textCase: "lower",
  }),
  definePreset("cinematic", "clean", "Cinematic", "Elegant serif that focus-pulls in under a slow light sweep — travel, film.", {
    fontFamily: "dmSerifDisplay",
    weight: 500,
    scale: 0.04,
    textColor: "#f5f5f4",
    highlightColor: "#e7c590",
    boxOpacity: 0.5,
    animation: "blur",
    loop: "shine",
  }),
  definePreset("soft-aesthetic", "clean", "Soft Aesthetic", "Rounded text on a gently floating pastel pill — lifestyle, beauty, vlogs.", {
    fontFamily: "lilitaOne",
    textColor: "#3f3f46",
    highlightColor: "#db2777",
    treatment: "box",
    boxColor: "#fce7f3",
    boxOpacity: 0.92,
    animation: "rise",
    loop: "float",
  }),
];
