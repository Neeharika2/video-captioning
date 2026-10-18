import { describe, expect, it } from "vitest";
import { hasIndicScript, romanize, romanizeWords } from "./romanize";

describe("romanize: Telugu", () => {
  it.each([
    ["ఎలా ఉన్నారు అందరూ", "ela unnaru andharu"],
    ["ఎలా ఉన్నారు?", "ela unnaru?"],
    ["అందరూ బాగున్నారా?", "andharu baagunnara?"],
    ["మా అమ్మ చాలా బాగా వంట చేస్తుంది", "maa amma chaala baaga vanta chesthundhi"],
    ["కాదు", "kaadhu"],
    ["నమస్కారం", "namaskaram"],
    ["మీరు ఏమి చేస్తున్నారు?", "meeru emi chesthunnaru?"],
    ["ఈరోజు office కి వెళ్తాను.", "eeroju office ki velthanu."],
    ["నాకు తెలియదు", "naaku theliyadhu"],
    ["మా అమ్మ", "maa amma"],
    ["రా", "raa"],
    ["అత్త", "atta"],
    ["ముద్దు", "muddu"],
    ["అక్క", "akka"],
    ["వచ్చింది", "vacchindhi"],
    ["ఊరు", "ooru"],
    ["ఏమీ లేదు", "emi ledhu"],
    ["సంసారం", "samsaram"],
    ["కృష్ణ", "krushna"],
    ["౧౨౩", "123"],
  ])("%s → %s", (input, expected) => {
    expect(romanize(input)).toBe(expected);
  });
});

describe("romanize: other scripts", () => {
  it.each([
    ["आप कैसे हैं", "aap kaise hain"],
    ["नमस्ते", "namaste"],
    ["कमल", "kamal"],
    ["ज़िंदगी", "zindagi"],
    ["ಹೇಗಿದ್ದೀರಾ", "hegiddeera"],
    ["வணக்கம்", "vanakkam"],
  ])("%s → %s", (input, expected) => {
    expect(romanize(input)).toBe(expected);
  });

  it("leaves Latin text, punctuation and spacing alone", () => {
    expect(romanize("Hello, world! (test) 42")).toBe("Hello, world! (test) 42");
  });
});

describe("romanizeWords", () => {
  it("keeps timings and only changes Indic words", () => {
    const words = [
      { text: "హలో", start: 0.2, end: 0.5, speaker: "spk_1" },
      { text: "everyone", start: 0.5, end: 1 },
    ];
    expect(romanizeWords(words)).toEqual([
      { text: "halo", start: 0.2, end: 0.5, speaker: "spk_1" },
      { text: "everyone", start: 0.5, end: 1 },
    ]);
    expect(hasIndicScript("హలో")).toBe(true);
    expect(hasIndicScript("hello")).toBe(false);
  });
});
