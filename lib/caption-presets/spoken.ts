import { definePreset } from "./define-preset";

/**
 * The well-liked spoken presets: the accent follows the word being said.
 * Deliberately left as they were — the layout work must not change these.
 */
export const SPOKEN_PRESETS = [
  definePreset("karaoke", "spoken", "Karaoke", "Each word fills with yellow from left to right as it's sung or spoken.", {
    fontFamily: "archivoBlack",
    weight: 700,
    scale: 0.05,
    highlightColor: "#fde047",
    emphasis: "sweep",
  }),
  definePreset("glide-box", "spoken", "Glide Box", "A purple box glides from word to word as they're spoken — explainers.", {
    fontFamily: "montserrat",
    weight: 800,
    scale: 0.05,
    highlightColor: "#7c3aed",
    emphasis: "box",
    animation: "pop",
    wordMotion: "grow",
    textCase: "upper",
  }),
  definePreset("highlighter", "spoken", "Highlighter", "A yellow marker sweeps under each word as it's spoken — notes, study.", {
    fontFamily: "poppins",
    weight: 700,
    scale: 0.048,
    highlightColor: "#facc15",
    emphasis: "marker",
    animation: "rise",
  }),
  definePreset("creator-pop", "spoken", "Creator Pop", "Handwritten text with a green underline gliding word to word — tutorials.", {
    fontFamily: "permanentMarker",
    weight: 700,
    scale: 0.05,
    highlightColor: "#4ade80",
    emphasis: "underline",
    animation: "pop",
    wordMotion: "lift",
  }),
  definePreset("outline-fill", "spoken", "Outline Fill", "Hollow outlined capitals that flood solid as each word is spoken.", {
    fontFamily: "anton",
    weight: 400,
    scale: 0.06,
    treatment: "plain",
    emphasis: "fill",
    textCase: "upper",
    animation: "rise",
  }),
  definePreset("word-tiles", "spoken", "Word Tiles", "Every word on its own white tile; the spoken one turns yellow — sticker look.", {
    fontFamily: "poppins",
    weight: 800,
    scale: 0.044,
    textColor: "#111111",
    highlightColor: "#facc15",
    treatment: "tiles",
    boxColor: "#ffffff",
    boxOpacity: 1,
    emphasis: "box",
    animation: "pop",
    animateBy: "word",
  }),
  definePreset("weight-shift", "spoken", "Weight Shift", "Quiet lowercase, one colour; each word turns from light to bold as it's said.", {
    fontFamily: "montserrat",
    weight: 300,
    scale: 0.046,
    emphasis: "weight",
    textCase: "lower",
  }),
];
