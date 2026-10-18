import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiError, TranscribeResponse } from "../api-types";
import { GeminiError, type TranscribeRequest, type TranscribeResult } from "../gemini";
import type { ServerConfig } from "./config";
import { MemoryQuota } from "./quota";
import { handleTranscribe } from "./transcribe-handler";

const baseConfig: ServerConfig = {
  geminiApiKey: "gem-key",
  geminiModel: "test-model",
  spellModel: "test-text-model",
  quotaMinutesPerDay: 1,
  requestsPerMinute: 100,
  maxChunkSeconds: 600,
  maxUploadBytes: 4_400_000,
  upstashUrl: "",
  upstashToken: "",
  isProduction: true,
};

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

const okResult = (req: TranscribeRequest): TranscribeResult => ({
  text: "hello",
  words: [{ text: "hello", start: 0.1, end: 0.5 }],
  latencyMs: 10,
  attempts: 1,
  raw: { languages: req.languageCodes },
});

function request(body: Uint8Array | string, init: { type?: string; query?: string } = {}) {
  const headers: Record<string, string> = { "content-type": init.type ?? "audio/ogg" };
  return new Request(`http://localhost/api/transcribe${init.query ?? ""}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : new Blob([body as BlobPart]),
  });
}

async function call(req: Request, deps: Parameters<typeof handleTranscribe>[1] = {}) {
  const config = deps.config ?? baseConfig;
  const res = await handleTranscribe(req, {
    config,
    quota: deps.quota ?? new MemoryQuota(config),
    transcribe: deps.transcribe ?? (async (r) => okResult(r)),
  });
  return { status: res.status, body: (await res.json()) as TranscribeResponse & ApiError, headers: res.headers };
}

vi.spyOn(console, "info").mockImplementation(() => {});

describe("handleTranscribe", () => {
  it("returns words, server-measured duration and quota", async () => {
    const transcribe = vi.fn(async (r: TranscribeRequest) => okResult(r));
    const { status, body } = await call(request(ogg5s, { query: "?languages=te-IN,en-IN" }), { transcribe });
    expect(status).toBe(200);
    expect(body.words).toEqual([{ text: "hello", start: 0.1, end: 0.5 }]);
    expect(body.durationSec).toBeCloseTo(5, 1);
    expect(body.model).toBe("test-model");
    expect(body.quota).toEqual({ usedSeconds: 5, limitSeconds: 60 });
    const sent = transcribe.mock.calls[0][0];
    expect(sent).toMatchObject({ apiKey: "gem-key", timestamps: true, languageCodes: ["te-IN", "en-IN"] });
  });

  it("refuses to run without a Gemini key configured", async () => {
    const { status, body } = await call(request(ogg5s), { config: { ...baseConfig, geminiApiKey: "" } });
    expect(status).toBe(500);
    expect(body.code).toBe("misconfigured");
  });

  it("validates content type, body and language codes", async () => {
    expect((await call(request(ogg5s, { type: "application/json" }))).status).toBe(415);
    expect((await call(request("not ogg at all, just some text padding padding"))).body.code).toBe("unsupported_media");
    expect((await call(request(new Uint8Array()))).status).toBe(400);
    expect((await call(request(ogg5s, { query: "?languages=te-IN,<script>" }))).status).toBe(400);
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

  it("enforces the daily quota and refunds failed requests", async () => {
    const quota = new MemoryQuota(baseConfig); // 60 s/day
    expect((await call(request(ogg40s), { quota })).status).toBe(200);

    // Second 40 s chunk would exceed 60 s.
    const over = await call(request(ogg40s), { quota });
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("quota_exceeded");
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);

    // A failed 5 s request is refunded, so 20 s of quota stays available.
    const failing = vi.fn(async () => {
      throw new GeminiError("Gemini 503: busy", 503, true);
    });
    expect((await call(request(ogg5s), { quota, transcribe: failing })).status).toBe(502);
    const again = await call(request(ogg5s), { quota });
    expect(again.body.quota.usedSeconds).toBe(45);
  });

  it("rate-limits requests per minute", async () => {
    const config = { ...baseConfig, requestsPerMinute: 1, quotaMinutesPerDay: 100 };
    const quota = new MemoryQuota(config);
    expect((await call(request(ogg5s), { config, quota })).status).toBe(200);
    const limited = await call(request(ogg5s), { config, quota });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: "rate_limited", retryable: true });
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
