import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { TranscribeResponse } from "../lib/api-types";
import { oggOpusDuration } from "../lib/ogg-duration";
import { FIXTURES } from "./global-setup";

const fixture = (name: string) => path.join(FIXTURES, name);

type Captured = { bytes: Uint8Array; durationSec: number; contentType?: string };

/** Mock the API so these tests are free and deterministic; checks the upload is real Ogg Opus. */
async function mockApi(page: Page, words = [{ text: "Hello", start: 0.2, end: 0.6 }, { text: "everyone.", start: 0.6, end: 1.1 }]) {
  const captured: Captured[] = [];
  await page.route("**/api/transcribe**", async (route) => {
    const bytes = new Uint8Array(route.request().postDataBuffer() ?? []);
    const durationSec = oggOpusDuration(bytes);
    captured.push({ bytes, durationSec, contentType: route.request().headers()["content-type"] });
    const body: TranscribeResponse = {
      words,
      text: words.map((w) => w.text).join(" "),
      durationSec,
      model: "mock",
      quota: { usedSeconds: Math.ceil(durationSec), limitSeconds: 7200 },
    };
    await route.fulfill({ json: body });
  });
  return captured;
}

async function runPipeline(page: Page, file: string, engine?: "mediabunny" | "ffmpeg") {
  await page.goto("/debug");
  if (engine) {
    await page.getByTestId("advanced").click();
    await page.getByLabel("Extraction engine").selectOption(engine);
  }
  await page.getByTestId("file-input").setInputFiles(fixture(file));
  await page.getByRole("button", { name: "Make captions" }).click();
}

test("MP4 → Mediabunny → Ogg Opus upload → words shown", async ({ page }) => {
  const captured = await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  expect(captured).toHaveLength(1);
  expect(captured[0].contentType).toBe("audio/ogg");
  // Fixture audio is ~6-8 s of speech.
  expect(captured[0].durationSec).toBeGreaterThan(4);
  expect(captured[0].durationSec).toBeLessThan(9);
  // ~24 kbps → well under 100 KB for a few seconds.
  expect(captured[0].bytes.byteLength).toBeLessThan(100_000);

  await expect(page.getByTestId("log")).toContainText("Extracted with mediabunny");
  await expect(page.getByTestId("words").locator("button")).toHaveCount(2);
});

test("clicking a word seeks the video and highlights it", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });
  await page.getByTestId("advanced").click();
  await page.getByTestId("words").getByRole("button", { name: /everyone/ }).click();
  await expect(page.getByTestId("overlay")).toContainText("everyone.");
  const t = await page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(t).toBeCloseTo(0.6, 1);
});

test("captions are grouped and downloadable as SRT", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });
  await expect(page.getByTestId("captions")).toContainText("Hello everyone.");

  const srt = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .srt" }).click();
  const srtPath = await (await srt).path();
  const text = (await import("node:fs")).readFileSync(srtPath, "utf8");
  expect(text).toContain("00:00:00,200 --> ");
  expect(text).toContain("Hello everyone.");
});

test("AVI falls back to ffmpeg.wasm", async ({ page }) => {
  const captured = await mockApi(page);
  await runPipeline(page, "speech.avi");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 90_000 });
  await expect(page.getByTestId("log")).toContainText("Extracted with ffmpeg");
  expect(captured).toHaveLength(1);
  expect(captured[0].durationSec).toBeGreaterThan(4);
});

test("ffmpeg.wasm engine also handles MP4", async ({ page }) => {
  const captured = await mockApi(page);
  await runPipeline(page, "speech.mp4", "ffmpeg");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 90_000 });
  await expect(page.getByTestId("log")).toContainText("Extracted with ffmpeg");
  expect(captured[0].durationSec).toBeGreaterThan(4);
});

test("video without audio shows a clear error and never uploads", async ({ page }) => {
  const captured = await mockApi(page);
  await runPipeline(page, "no-audio.mp4");
  await expect(page.getByTestId("status")).toContainText("no audio track", { timeout: 30_000 });
  expect(captured).toHaveLength(0);
});

test("server errors are shown with their code", async ({ page }) => {
  await page.route("**/api/transcribe**", (route) =>
    route.fulfill({
      status: 429,
      json: { error: "Daily audio quota used (120 of 120 min)", code: "quota_exceeded", retryable: false, retryAfterSec: 3600 },
    }),
  );
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toContainText("Daily audio quota used", { timeout: 60_000 });
  await expect(page.getByTestId("status")).toContainText("quota_exceeded");
});

// Real end-to-end run against Gemini. Costs ~$0.001. Opt in with E2E_REAL=1.
test("real transcription through the API route", async ({ page }) => {
  test.skip(!process.env.E2E_REAL, "set E2E_REAL=1 to call Gemini");
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 120_000 });
  const words = page.getByTestId("words");
  await expect(words).toContainText("Kubernetes");
  expect(await words.getByRole("button").count()).toBeGreaterThan(8);
});
