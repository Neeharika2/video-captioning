import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { API_KEY_HEADER, SPEAKERS_HEADER, type ApiError, type TranscribeResponse } from "../api-types";
import { GeminiError, type TranscribeRequest, type TranscribeResult } from "../gemini";
import type { ServerConfig } from "./config";
import { MemoryLimiter } from "./limits";
import { handleTranscribe } from "./transcribe-handler";

const baseConfig: ServerConfig = {
  geminiModel: "test-model",
  spellModel: "test-text-model",
  requestsPerMinute: 100,
  maxChunkSeconds: 600,
  maxUploadBytes: 4_400_000,
  upstashUrl: "",
  upstashToken: "",
  isProduction: true,
};

/** Shape-valid fake key; nothing here reaches Google. */
const TEST_KEY = "AIzaSyTEST-key_0123456789";

let ogg5s: Uint8Array;
let ogg40s: Uint8Array;
beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "handler-test-"));
  const make = (sec: number) => {
    const out = path.join(dir, `${sec}.ogg`);
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `sine=duration=${sec}`,
      "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", out,
    ]);
    return new Uint8Array(readFileSync(out));
  };
  ogg5s = make(5);
  ogg40s = make(40);
});

const okResult = (): TranscribeResult => ({
  text: "hello",
  words: [{ text: "hello", start: 0.1, end: 0.5 }],
  latencyMs: 10,
  attempts: 1,
  raw: {},
});

function request(body: Uint8Array | string, init: { type?: string; key?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": init.type ?? "audio/ogg" };
  const key = init.key === undefined ? TEST_KEY : init.key;
  if (key) headers[API_KEY_HEADER] = key;
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : new Blob([body as BlobPart]),
  });
}

async function call(req: Request, deps: Parameters<typeof handleTranscribe>[1] = {}) {
  const config = deps.config ?? baseConfig;
  const res = await handleTranscribe(req, {
    config,
    limiter: deps.limiter ?? new MemoryLimiter(config),
    transcribe: deps.transcribe ?? (async () => okResult()),
  });
  return { status: res.status, body: (await res.json()) as TranscribeResponse & ApiError, headers: res.headers };
}

vi.spyOn(console, "info").mockImplementation(() => {});

describe("handleTranscribe", () => {
  it("returns words and the server-measured duration, using the caller's key", async () => {
    const transcribe = vi.fn<(req: TranscribeRequest) => Promise<TranscribeResult>>(async () => okResult());
    const { status, body } = await call(request(ogg5s), { transcribe });
    expect(status).toBe(200);
    expect(body.words).toEqual([{ text: "hello", start: 0.1, end: 0.5 }]);
    expect(body.durationSec).toBeCloseTo(5, 1);
    expect(body.model).toBe("test-model");
    const sent = transcribe.mock.calls[0][0];
    expect(sent).toMatchObject({ apiKey: TEST_KEY, timestamps: true });
    expect(sent).not.toHaveProperty("languageCodes");
  });

  it("asks for speaker labels only when the caller opts in", async () => {
    const transcribe = vi.fn<(req: TranscribeRequest) => Promise<TranscribeResult>>(async () => okResult());
    await call(request(ogg5s), { transcribe });
    expect(transcribe.mock.calls[0][0].diarization).toBe(false);
    const withSpeakers = request(ogg5s);
    withSpeakers.headers.set(SPEAKERS_HEADER, "1");
    await call(withSpeakers, { transcribe });
    expect(transcribe.mock.calls[1][0].diarization).toBe(true);
  });

  it("spreads a transcript that came back without word timings", async () => {
    const { status, body } = await call(request(ogg5s), {
      transcribe: async () => ({ text: "hello there world", words: [], latencyMs: 5, attempts: 1, raw: {} }),
    });
    expect(status).toBe(200);
    expect(body.words.map((w) => w.text)).toEqual(["hello", "there", "world"]);
    expect(body.words[0].start).toBe(0);
    // Even split across the server-measured duration.
    expect(body.words[body.words.length - 1].end).toBeCloseTo(5, 1);
  });

  it("leaves words empty when the clip had no speech to transcribe", async () => {
    const { status, body } = await call(request(ogg5s), {
      transcribe: async () => ({ text: "", words: [], latencyMs: 5, attempts: 1, raw: {} }),
    });
    expect(status).toBe(200);
    expect(body.words).toEqual([]);
  });

  it("asks for a key when none is sent", async () => {
    const { status, body } = await call(request(ogg5s, { key: null }));
    expect(status).toBe(401);
    expect(body.code).toBe("needs_api_key");
    expect(body.error).toMatch(/Settings/);
  });

  it("rejects a malformed key", async () => {
    const { status, body } = await call(request(ogg5s, { key: "not a key" }));
    expect(status).toBe(401);
    expect(body.code).toBe("needs_api_key");
    expect(body.error).toMatch(/doesn't look valid/);
  });

  it("validates content type and body", async () => {
    expect((await call(request(ogg5s, { type: "application/json" }))).status).toBe(415);
    expect((await call(request("not ogg at all, just some text padding padding"))).body.code).toBe("unsupported_media");
    expect((await call(request(new Uint8Array()))).status).toBe(400);
  });

  it("rejects uploads over the size limit", async () => {
    const { status, body } = await call(request(ogg5s), { config: { ...baseConfig, maxUploadBytes: 1000 } });
    expect(status).toBe(413);
    expect(body.code).toBe("too_large");
  });

  it("rejects chunks longer than the limit, using the real duration", async () => {
    const { status, body } = await call(request(ogg40s), { config: { ...baseConfig, maxChunkSeconds: 30 } });
    expect(status).toBe(413);
    expect(body.code).toBe("too_long");
  });

  it("rate-limits per key, so visitors don't share a bucket", async () => {
    const config = { ...baseConfig, requestsPerMinute: 1 };
    const limiter = new MemoryLimiter(config);
    expect((await call(request(ogg40s), { config, limiter })).status).toBe(200);

    // A different visitor's key has its own window.
    const other = await call(request(ogg40s, { key: "AIzaSyOTHER-key_9876543210" }), { config, limiter });
    expect(other.status).toBe(200);

    const limited = await call(request(ogg40s), { config, limiter });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: "rate_limited", retryable: true });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it.each([
    [new GeminiError("Gemini request timed out", undefined, true), 504, "timeout", true],
    [new GeminiError("Gemini 429: quota", 429, true), 503, "upstream_busy", true],
    [new GeminiError("Gemini 500: oops", 500, true), 502, "upstream", true],
    [new GeminiError("Gemini 400: bad audio", 400, false), 422, "upstream", false],
    [new Error("boom"), 502, "upstream", true],
  ])("maps upstream error %#", async (err, status, code, retryable) => {
    const res = await call(request(ogg5s), {
      transcribe: async () => {
        throw err;
      },
    });
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ code, retryable });
  });

  it("reports an exhausted Gemini daily limit instead of hanging", async () => {
    const res = await call(request(ogg5s), {
      transcribe: async () => {
        throw new GeminiError(
          "Gemini 429: Rate limit exceeded (limit: 25 requests per day on Free Tier).",
          429,
          true,
          undefined,
          35084,
        );
      },
    });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: "quota_exceeded", retryable: false, retryAfterSec: 35084 });
    expect(res.body.error).toMatch(/free tier/i);
    expect(res.headers.get("retry-after")).toBe("35084");
  });
});
