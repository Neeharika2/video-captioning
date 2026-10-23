import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { TranscribeResponse } from "../lib/api-types";
import { oggOpusDuration } from "../lib/ogg-duration";
import { FIXTURES } from "./global-setup";

const fixture = (name: string) => path.join(FIXTURES, name);

type Captured = { bytes: Uint8Array; durationSec: number; contentType?: string; languages: string | null };

/** Mock the API so these tests are free and deterministic; checks the upload is real Ogg Opus. */
async function mockApi(page: Page, words = [{ text: "Hello", start: 0.2, end: 0.6 }, { text: "everyone.", start: 0.6, end: 1.1 }]) {
  const captured: Captured[] = [];
  await page.route("**/api/transcribe**", async (route) => {
    const bytes = new Uint8Array(route.request().postDataBuffer() ?? []);
    const durationSec = oggOpusDuration(bytes);
    const languages = new URL(route.request().url()).searchParams.get("languages");
    captured.push({ bytes, durationSec, contentType: route.request().headers()["content-type"], languages });
    const body: TranscribeResponse = {
      words,
      text: words.map((w) => w.text).join(" "),
      durationSec,
      model: "mock",
    };
    await route.fulfill({ json: body });
  });
  return captured;
}

/** Shape-valid fake key so the client-side "missing key" guard passes. */
const E2E_KEY = "AIzaSyE2E-test-key_0123456789";

async function runPipeline(
  page: Page,
  file: string,
  engine?: "mediabunny" | "ffmpeg",
  opts: { withKey?: boolean; repair?: boolean } = {},
) {
  if (opts.withKey !== false) {
    await page.addInitScript((key) => window.localStorage.setItem("vc.geminiApiKey", key), E2E_KEY);
  }
  // Query params force an engine and disable the multi-request repair, so these
  // UI tests stay single-request; the repair pass has its own test below.
  const params = new URLSearchParams();
  if (engine) params.set("engine", engine);
  if (!opts.repair) params.set("repair", "off");
  const qs = params.toString();
  await page.goto(qs ? `/debug?${qs}` : "/debug");
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

test("preview keeps the video's own aspect ratio and captions stay in frame", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  await page.getByTestId("captions").getByRole("button").first().click();
  await expect(page.getByTestId("overlay")).toBeVisible();
  await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement | null)?.videoWidth);

  const info = await page.evaluate(() => {
    const video = document.querySelector("video") as HTMLVideoElement;
    const overlay = document.querySelector('[data-testid="overlay"]') as HTMLElement;
    const v = video.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    return {
      intrinsic: video.videoWidth / video.videoHeight,
      rendered: v.width / v.height,
      // Overlay should sit exactly on the video, not on letterbox bars.
      dx: Math.abs(o.left - v.left) + Math.abs(o.right - v.right),
      dy: Math.abs(o.top - v.top) + Math.abs(o.bottom - v.bottom),
    };
  });
  expect(info.rendered).toBeCloseTo(info.intrinsic, 1);
  expect(info.dx).toBeLessThan(2);
  expect(info.dy).toBeLessThan(2);
});

test("captions are grouped and downloadable as SRT", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });
  await expect(page.getByTestId("captions")).toContainText("Hello everyone.");

  const srt = page.waitForEvent("download");
  await page.getByTestId("export-menu").click();
  await page.getByRole("button", { name: "Download .srt" }).click();
  const srtPath = await (await srt).path();
  const text = (await import("node:fs")).readFileSync(srtPath, "utf8");
  expect(text).toContain("00:00:00,200 --> ");
  expect(text).toContain("Hello everyone.");
});

test("captions can be edited, and the edit flows to the export", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  await page.getByTestId("captions").getByRole("button", { name: /Hello everyone/ }).click();
  const box = page.getByTestId("captions").locator("textarea");
  await box.fill("Hi all.");
  await box.press("Enter");

  await expect(page.getByTestId("captions")).toContainText("Hi all.");
  await expect(page.getByTestId("captions")).toContainText("edited");

  const dl = page.waitForEvent("download");
  await page.getByTestId("export-menu").click();
  await page.getByRole("button", { name: "Download .srt" }).click();
  const text = (await import("node:fs")).readFileSync(await (await dl).path(), "utf8");
  expect(text).toContain("Hi all.");
  expect(text).not.toContain("Hello everyone.");
});

test("a caption can be retimed on the timeline and the new time is exported", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  // Select the cue on the timeline, then nudge it 0.1 s later.
  const segment = page.getByTestId("timeline").getByRole("button", { name: /Hello everyone/ });
  await segment.click();
  await expect(page.getByTestId("timeline-selected")).toContainText("0:00.20");
  await page.getByRole("button", { name: /^0\.1s/ }).click();
  await expect(page.getByTestId("timeline-selected")).toContainText("0:00.30");

  // Dragging the segment moves it in time too.
  const box = await segment.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("timeline-selected")).not.toContainText("0:00.30");

  const dl = page.waitForEvent("download");
  await page.getByTestId("export-menu").click();
  await page.getByRole("button", { name: "Download .srt" }).click();
  const text = (await import("node:fs")).readFileSync(await (await dl).path(), "utf8");
  // The dragged time is what gets exported (later than the 0.3 s nudge).
  const start = /(\d\d):(\d\d):(\d\d),(\d\d\d) -->/.exec(text);
  expect(start).not.toBeNull();
  const startSec = Number(start![1]) * 3600 + Number(start![2]) * 60 + Number(start![3]) + Number(start![4]) / 1000;
  expect(startSec).toBeGreaterThan(0.3);
});

test("a caption can be dragged anywhere in the frame", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  // Paused, so the caption is settled and easy to grab.
  await page.getByTestId("captions").getByRole("button").first().click();
  const block = page.getByTestId("overlay").locator("[data-caption-block]");
  await expect(block).toBeVisible();

  const before = (await block.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 - 120, { steps: 8 });
  await page.mouse.up();

  const after = (await block.boundingBox())!;
  expect(after.y).toBeLessThan(before.y - 40);

  // Placement is per caption, so it marks this cue (and drives the export).
  await expect(block).toHaveAttribute("data-offset-y", /^-\d/);
  await expect(page.getByTestId("captions")).toContainText("moved");
});

test("each caption can sit in its own spot", async ({ page }) => {
  await mockApi(page, [
    { text: "Hello", start: 0.2, end: 0.7 },
    { text: "again", start: 2.0, end: 2.5 },
  ]);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  const block = page.getByTestId("overlay").locator("[data-caption-block]");
  const captions = page.getByTestId("captions");

  // Move the first caption up; the second keeps the default spot.
  await captions.getByRole("button", { name: "0:00" }).click();
  await expect(block).toHaveAttribute("data-offset-y", "0");
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 100, { steps: 6 });
  await page.mouse.up();
  await expect(block).toHaveAttribute("data-offset-y", /^-\d/);

  await captions.getByRole("button", { name: "0:02" }).click();
  await expect(block).toHaveAttribute("data-offset-y", "0");
});

test("no caption is shown in the gap between captions", async ({ page }) => {
  await mockApi(page, [
    { text: "Hello", start: 0.2, end: 0.7 },
    { text: "again", start: 2.0, end: 2.5 },
  ]);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  const overlay = page.getByTestId("overlay");
  await page.getByTestId("captions").getByRole("button", { name: "0:00" }).click();
  await expect(overlay).toContainText("Hello");

  // Jump into the gap between the two cues: nothing should be on screen.
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 1.5;
  });
  await expect(overlay).toHaveCount(0);

  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 2.1;
  });
  await expect(overlay).toContainText("again");
});

test("captions animate in when they appear", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  await page.getByRole("button", { name: "Pop", exact: true }).click();
  await page.getByTestId("captions").getByRole("button").first().click();
  await expect(page.getByTestId("overlay").locator("[data-caption-block]")).toHaveAttribute("data-animation", "pop");
});

test("style presets apply their look to the preview", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  await page.getByTestId("captions").getByRole("button").first().click();
  const block = page.getByTestId("overlay").locator("[data-caption-block]");
  await expect(block).toBeVisible();

  // Bold Viral uppercases the text and strokes the glyphs (outline axis).
  await page.getByRole("button", { name: "Bold Viral" }).click();
  await expect(block).toHaveCSS("text-transform", "uppercase");
  await expect(block).toHaveAttribute("data-outline", "true");
  await expect(block).toHaveAttribute("data-animate-by", "word");

  // Soft Aesthetic paints a pastel pill, no outline, and floats.
  await page.getByRole("button", { name: "Soft Aesthetic" }).click();
  await expect(block).toHaveAttribute("data-treatment", "box");
  await expect(block).toHaveAttribute("data-outline", "false");
  await expect(block).toHaveAttribute("data-loop", "float");

  // Outline is its own axis, so it layers onto any preset.
  await page.getByRole("checkbox", { name: "Outline" }).check();
  await expect(block).toHaveAttribute("data-outline", "true");
});

test("words on screen regroups the captions", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  const timeline = page.getByTestId("timeline");
  await expect(timeline.getByRole("button", { name: /Hello everyone/ })).toHaveCount(1);

  // Big Word shows one word at a time, so the cue splits in two.
  await page.getByRole("button", { name: "Big Word" }).click();
  await expect(timeline.getByRole("button", { name: /Hello everyone/ })).toHaveCount(0);
  await expect(timeline.getByRole("button", { name: /Hello/ })).toHaveCount(1);
  await expect(timeline.getByRole("button", { name: /everyone/ })).toHaveCount(1);

  // Back to four words: one cue again.
  await page.getByRole("group", { name: "Words on screen" }).getByRole("button", { name: "4" }).click();
  await expect(timeline.getByRole("button", { name: /Hello everyone/ })).toHaveCount(1);
});

test("effects can be mixed and the caption is painted on the canvas", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  await page.getByTestId("captions").getByRole("button").first().click();
  const block = page.getByTestId("overlay").locator("[data-caption-block]");
  await expect(block).toBeVisible();

  await page.getByRole("group", { name: "Spoken word" }).getByRole("button", { name: "Box" }).click();
  await page.getByRole("group", { name: "Loop" }).getByRole("button", { name: "Wave" }).click();
  await page.getByRole("group", { name: "Animate by" }).getByRole("button", { name: "Letter" }).click();
  await expect(block).toHaveAttribute("data-emphasis", "box");
  await expect(block).toHaveAttribute("data-loop", "wave");
  await expect(block).toHaveAttribute("data-animate-by", "letter");

  // The visible caption comes from the canvas, not the (transparent) text.
  await expect(block).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  const painted = await page.getByTestId("caption-canvas").evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(100);
});

test("the font picker previews each face in its own style", async ({ page }) => {
  await mockApi(page);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  await page.getByTestId("captions").getByRole("button").first().click();
  const block = page.getByTestId("overlay").locator("[data-caption-block]");
  await expect(block).toBeVisible();

  // The list renders each option in its own face before it is chosen.
  await page.getByRole("button", { name: "Font" }).click();
  const bungee = page.getByRole("option", { name: /Bungee/ });
  await expect(bungee.locator("span").first()).toHaveCSS("font-family", /Bungee/);

  // Choosing it switches the live preview over as well.
  await bungee.click();
  await expect(block).toHaveCSS("font-family", /Bungee/);
});

test("a caption can be resized from a corner and synced to all", async ({ page }) => {
  await mockApi(page, [
    { text: "Hello.", start: 0.2, end: 0.6 },
    { text: "Second", start: 3, end: 3.4 },
    { text: "caption.", start: 3.4, end: 3.9 },
  ]);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  const captionButtons = page.getByTestId("captions").getByRole("button");
  await captionButtons.first().click();
  const block = page.getByTestId("overlay").locator("[data-caption-block]");
  await expect(block).toBeVisible();
  const before = await block.getAttribute("data-scale");

  // Drag the south-east corner outwards: the cue gets its own size.
  const handle = block.locator('[data-resize-handle="se"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error("missing resize handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 100, { steps: 10 });
  await page.mouse.up();

  const resized = await block.getAttribute("data-scale");
  expect(Number(resized)).toBeGreaterThan(Number(before));
  await expect(page.getByTestId("captions")).toContainText("sized");

  // Make this cue's size the default for every cue.
  await page.getByRole("button", { name: "Sync size to all" }).click();
  await expect(block).toHaveAttribute("data-scale", resized ?? "");
  await expect(page.getByTestId("captions")).not.toContainText("sized");

  // The second cue now uses the same size.
  await captionButtons.nth(2).click();
  await expect(block).toHaveAttribute("data-scale", resized ?? "");
});

test("a caption can be moved and its position synced to all", async ({ page }) => {
  await mockApi(page, [
    { text: "Hello.", start: 0.2, end: 0.6 },
    { text: "Second", start: 3, end: 3.4 },
    { text: "caption.", start: 3.4, end: 3.9 },
  ]);
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });

  const captionButtons = page.getByTestId("captions").getByRole("button");
  await captionButtons.first().click();
  const block = page.getByTestId("overlay").locator("[data-caption-block]");
  await expect(block).toBeVisible();

  // Drag the caption up: the cue gets its own spot.
  const before = (await block.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 - 100, { steps: 8 });
  await page.mouse.up();

  const offsetY = await block.getAttribute("data-offset-y");
  expect(offsetY).toMatch(/^-\d/);
  await expect(page.getByTestId("captions")).toContainText("moved");

  // Make this cue's spot the default for every cue.
  await page.getByRole("button", { name: "Sync position to all" }).click();
  await expect(block).toHaveAttribute("data-offset-y", offsetY ?? "");
  await expect(page.getByTestId("captions")).not.toContainText("moved");

  // The third cue now sits in the same spot.
  await captionButtons.nth(2).click();
  await expect(block).toHaveAttribute("data-offset-y", offsetY ?? "");
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
      json: {
        error:
          "Gemini daily limit reached for gemini-3.5-transcribe. Retry in 9h 43m. This API key is on the free tier (25 transcription requests per day); enable billing or use a paid-tier key.",
        code: "quota_exceeded",
        retryable: false,
        retryAfterSec: 35_084,
      },
    }),
  );
  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toContainText("Gemini daily limit reached", { timeout: 60_000 });
  await expect(page.getByTestId("status")).toContainText("quota_exceeded");
});

// Real end-to-end run against Gemini. Costs a fraction of a cent. Opt in with
// E2E_REAL=1 and a personal GEMINI_API_KEY (the app no longer ships a shared key).
test("real transcription through the API route", async ({ page }) => {
  const key = process.env.GEMINI_API_KEY;
  test.skip(!process.env.E2E_REAL || !key, "set E2E_REAL=1 and GEMINI_API_KEY to call Gemini");
  await page.addInitScript((k) => window.localStorage.setItem("vc.geminiApiKey", k), key!);
  await runPipeline(page, "speech.mp4", undefined, { withKey: false });
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 120_000 });
  const words = page.getByTestId("words");
  await expect(words).toContainText("Kubernetes");
  expect(await words.getByRole("button").count()).toBeGreaterThan(8);
});

test("asks for a personal API key when none is set", async ({ page }) => {
  const captured = await mockApi(page);
  await runPipeline(page, "speech.mp4", undefined, { withKey: false });
  await expect(page.getByTestId("status")).toContainText("Gemini API key", { timeout: 15_000 });
  await expect(page.getByTestId("api-key")).toBeVisible();
  await expect(page.getByTestId("api-key-notice")).toBeVisible();
  expect(captured).toHaveLength(0);
});

test("reads back the language Gemini detected, and never sends a hint", async ({ page }) => {
  const captured = await mockApi(page, [
    { text: "आप", start: 0.2, end: 0.5 },
    { text: "कैसे", start: 0.5, end: 0.8 },
    { text: "हैं", start: 0.8, end: 1.1 },
  ]);
  // Keep the (always-on) spelling pass local; it doesn't affect this assertion.
  await page.route("**/api/spell**", async (route) => {
    const body = route.request().postDataJSON() as { words: string[] };
    await route.fulfill({ json: { words: body.words.map(() => null), rejected: body.words.length, model: "mock" } });
  });

  await runPipeline(page, "speech.mp4");
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });
  // The automatic pass sends no hint: Gemini chooses the language itself.
  expect(captured[0].languages).toBeNull();

  await page.getByTestId("advanced").click();
  await expect(page.getByTestId("detected-language")).toContainText("Devanagari script");
});

test("publishes final captions only after the spelling stage", async ({ page }) => {
  await mockApi(page, [
    { text: "आप", start: 0.2, end: 0.5 },
    { text: "कैसे", start: 0.5, end: 0.8 },
    { text: "हैं", start: 0.8, end: 1.1 },
  ]);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/spell**", async (route) => {
    await gate;
    const body = route.request().postDataJSON() as { words: string[] };
    await route.fulfill({ json: { words: body.words.map(() => null), rejected: body.words.length, model: "mock" } });
  });

  await runPipeline(page, "speech.mp4");
  // There is no separate visible step: it stays on "Transcribing…" until the
  // normalized captions are published.
  await expect(page.getByTestId("status")).toContainText("Transcribing", { timeout: 60_000 });
  await expect(page.getByTestId("captions")).toHaveCount(0);

  release();
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 60_000 });
  await expect(page.getByTestId("captions")).toContainText("aap");
});

test("re-transcribes the stretches Gemini auto-detect skipped", async ({ page }) => {
  const durations: number[] = [];
  let call = 0;
  await page.route("**/api/transcribe**", async (route) => {
    const bytes = new Uint8Array(route.request().postDataBuffer() ?? []);
    const durationSec = oggOpusDuration(bytes);
    durations.push(durationSec);
    call++;
    // Pass 1 hears only the middle of the track; every repair hears a short slice.
    const words =
      call === 1
        ? [{ text: "middle", start: durationSec * 0.5 - 0.05, end: durationSec * 0.5 + 0.05 }]
        : [
            { text: "edge-a", start: 0.2, end: 0.7 },
            { text: "edge-b", start: Math.max(0.8, durationSec - 0.9), end: Math.max(1.2, durationSec - 0.4) },
          ];
    await route.fulfill({
      json: { words, text: words.map((w) => w.text).join(" "), durationSec, model: "mock" },
    });
  });
  await page.route("**/api/spell**", async (route) => {
    const body = route.request().postDataJSON() as { words: string[] };
    await route.fulfill({ json: { words: body.words.map(() => null), rejected: body.words.length, model: "mock" } });
  });

  await runPipeline(page, "speech.mp4", undefined, { repair: true });
  await expect(page.getByTestId("status")).toHaveText("Done", { timeout: 120_000 });

  // The skipped start/end were picked up by separate, shorter requests.
  expect(call).toBeGreaterThan(1);
  expect(durations.some((d) => d < 4)).toBe(true);
  await expect(page.getByTestId("log")).toContainText("re-transcribing");
  await expect(page.getByTestId("words")).toContainText("middle");
  await expect(page.getByTestId("words")).toContainText("edge-a");

  // Repaired words keep their place on the video timeline (chunk offset added),
  // so at least one sits in the second half of the clip.
  const starts = await page.getByTestId("words").evaluate((el) =>
    Array.from(el.querySelectorAll("button")).map((b) =>
      Number.parseFloat((b.getAttribute("title") ?? "").split("–")[0]),
    ),
  );
  expect(starts.some((s) => s > durations[0] * 0.5)).toBe(true);
});
