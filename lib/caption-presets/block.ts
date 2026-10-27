import { definePreset } from "./define-preset";

/** Whole-block looks: no word-level highlight, the whole caption is styled. */
export const BLOCK_PRESETS = [
  definePreset("classic-reels", "block", "Classic Reels", "White bold text with a soft shadow — everyday reels, talking heads.", {
    fontFamily: "righteous",
    scale: 0.044,
  }),
  definePreset("cinematic", "block", "Cinematic", "Elegant serif that focus-pulls in under a slow light sweep — travel, film.", {
    fontFamily: "dmSerifDisplay",
    weight: 500,
    scale: 0.04,
    textColor: "#f5f5f4",
    highlightColor: "#e7c590",
    boxOpacity: 0.5,
    animation: "blur",
    loop: "shine",
  }),
  definePreset("soft-aesthetic", "block", "Soft Aesthetic", "Rounded text on a gently floating pastel pill — lifestyle, beauty, vlogs.", {
    fontFamily: "lilitaOne",
    textColor: "#3f3f46",
    highlightColor: "#db2777",
    treatment: "box",
    boxColor: "#fce7f3",
    boxOpacity: 0.92,
    animation: "rise",
    loop: "float",
  }),
  definePreset("big-word", "block", "Big Word", "One huge word at a time, dead centre, thick outline — high-energy hooks.", {
    fontFamily: "chewy",
    weight: 400,
    scale: 0.1,
    outline: true,
    position: "middle",
    animation: "pop",
    animateBy: "letter",
    textCase: "upper",
    wordsPerCaption: 1,
  }),
  definePreset("sunset-gradient", "block", "Sunset Gradient", "Chunky letters filled with a warm orange-to-gold gradient — travel, food.", {
    fontFamily: "archivoBlack",
    weight: 400,
    scale: 0.054,
    textColor: "#fb923c",
    highlightColor: "#fde047",
    gradient: true,
    animation: "rise",
    animateBy: "word",
  }),
];
