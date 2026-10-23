import { definePreset } from "./define-preset";

/** Distinctive motion and colour treatments. */
export const STYLISED_PRESETS = [
  definePreset("neon-creator", "stylised", "Neon Creator", "Cyan glow, a lit-up word and glitch bursts — gaming, tech, futuristic.", {
    fontFamily: "audiowide",
    weight: 800,
    scale: 0.052,
    highlightColor: "#22d3ee",
    treatment: "glow",
    emphasis: "color",
    animation: "pop",
    loop: "glitch",
  }),
  definePreset("sunset-gradient", "stylised", "Sunset Gradient", "Chunky letters filled with a warm orange-to-gold gradient — travel, food.", {
    fontFamily: "archivoBlack",
    weight: 400,
    scale: 0.054,
    textColor: "#fb923c",
    highlightColor: "#fde047",
    gradient: true,
    animation: "rise",
    animateBy: "word",
  }),
  definePreset("letter-wave", "stylised", "Letter Wave", "Letters rise in as they're spoken, then the line keeps waving — music, fun.", {
    fontFamily: "inter",
    weight: 800,
    scale: 0.05,
    animation: "rise",
    animateBy: "letter",
    loop: "wave",
  }),
];
