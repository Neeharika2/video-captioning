import { describe, expect, it, vi } from "vitest";
import { GeminiError } from "../gemini";
import type { generateJson } from "../gemini-text";
import type { SpellResponse } from "../spelling";
import type { ServerConfig } from "./config";
import { MemoryQuota } from "./quota";
import { handleSpell } from "./spell-handler";

const config: ServerConfig = {
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

function post(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/spell", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function generator(json: unknown) {
  return vi.fn<typeof generateJson>(async () => ({ json, latencyMs: 5, attempts: 1 }));
}

describe("handleSpell", () => {
  it("returns checked spellings, one per word", async () => {
    const generate = generator({
      words: [
        { id: 0, text: "ee", english: false },
        { id: 1, text: "today", english: true }, // translation → rejected
        { id: 2, text: "topic", english: true },
      ],
    });
    const res = await handleSpell(post({ words: ["ఈ", "రోజు", "టాపిక్"], glossary: ["LLMs"] }), {
      config,
      quota: new MemoryQuota(config),
      generate,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SpellResponse;
    expect(body.words).toEqual([{ text: "ee", english: false }, null, { text: "topic", english: true }]);
    expect(body.rejected).toBe(1);
    expect(body.model).toBe("test-text-model");
    const call = generate.mock.calls[0][0];
    expect(call.model).toBe("test-text-model");
    expect(call.prompt).toContain("Glossary: LLMs");
    expect(call.apiKey).toBe("gem-key");
  });

  it("validates the request", async () => {
    const deps = { config, quota: new MemoryQuota(config), generate: generator({ words: [] }) };
    expect((await handleSpell(post({ words: [] }), deps)).status).toBe(400);
    expect((await handleSpell(post("{oops"), deps)).status).toBe(400);
    expect((await handleSpell(post({ words: ["a"] }, "text/plain"), deps)).status).toBe(415);
    expect((await handleSpell(post({ words: Array(301).fill("a") }), deps)).status).toBe(400);
    expect((await handleSpell(post({ words: ["a"], languages: ["not a code"] }), deps)).status).toBe(400);
    expect((await handleSpell(post({ words: ["x".repeat(70_000)] }), deps)).status).toBe(413);
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it("needs the Gemini key", async () => {
    const res = await handleSpell(post({ words: ["a"] }), { config: { ...config, geminiApiKey: "" } });
    expect(res.status).toBe(500);
  });

  it("rate limits", async () => {
    const strict = { ...config, requestsPerMinute: 1 };
    const deps = { config: strict, quota: new MemoryQuota(strict), generate: generator({ words: [] }) };
    expect((await handleSpell(post({ words: ["a"] }), deps)).status).toBe(200);
    const res = await handleSpell(post({ words: ["a"] }), deps);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it.each([
    [new GeminiError("Gemini 429: quota", 429, true), 503, "upstream_busy"],
    [new GeminiError("Gemini request timed out", undefined, true), 504, "timeout"],
    [new GeminiError("Gemini 500: boom", 500, true), 502, "upstream"],
    [new GeminiError("Model returned invalid JSON (finish: MAX_TOKENS)"), 502, "upstream"],
  ])("maps %s", async (error, status, code) => {
    const generate = vi.fn<typeof generateJson>(async () => {
      throw error;
    });
    const res = await handleSpell(post({ words: ["a"] }), { config, quota: new MemoryQuota(config), generate });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { code: string }).code).toBe(code);
  });
});
