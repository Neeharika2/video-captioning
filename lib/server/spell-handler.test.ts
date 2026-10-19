import { describe, expect, it, vi } from "vitest";
import { API_KEY_HEADER } from "../api-types";
import { GeminiError } from "../gemini";
import type { generateJson } from "../gemini-text";
import type { SpellResponse } from "../spelling";
import type { ServerConfig } from "./config";
import { MemoryLimiter } from "./limits";
import { handleSpell } from "./spell-handler";

const config: ServerConfig = {
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

function post(body: unknown, init: { type?: string; key?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": init.type ?? "application/json" };
  const key = init.key === undefined ? TEST_KEY : init.key;
  if (key) headers[API_KEY_HEADER] = key;
  return new Request("http://localhost/api/spell", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function generator(json: unknown) {
  return vi.fn<typeof generateJson>(async () => ({ json, latencyMs: 5, attempts: 1 }));
}

function deps(overrides: Partial<ServerConfig> = {}, generate = generator({ words: [] })) {
  const cfg = { ...config, ...overrides };
  return { config: cfg, limiter: new MemoryLimiter(cfg), generate };
}

describe("handleSpell", () => {
  it("returns checked spellings, one per word, using the caller's key", async () => {
    const generate = generator({
      words: [
        { id: 0, text: "ee", english: false },
        { id: 1, text: "today", english: true }, // translation → rejected
        { id: 2, text: "topic", english: true },
      ],
    });
    const res = await handleSpell(post({ words: ["ఈ", "రోజు", "టాపిక్"], glossary: ["LLMs"] }), {
      ...deps({}, generate),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SpellResponse;
    expect(body.words).toEqual([{ text: "ee", english: false }, null, { text: "topic", english: true }]);
    expect(body.rejected).toBe(1);
    expect(body.model).toBe("test-text-model");
    const call = generate.mock.calls[0][0];
    expect(call.model).toBe("test-text-model");
    expect(call.prompt).toContain("Glossary: LLMs");
    expect(call.apiKey).toBe(TEST_KEY);
  });

  it("validates the request", async () => {
    const d = deps();
    expect((await handleSpell(post({ words: [] }), d)).status).toBe(400);
    expect((await handleSpell(post("{oops"), d)).status).toBe(400);
    expect((await handleSpell(post({ words: ["a"] }, { type: "text/plain" }), d)).status).toBe(415);
    expect((await handleSpell(post({ words: Array(301).fill("a") }), d)).status).toBe(400);
    expect((await handleSpell(post({ words: ["x".repeat(70_000)] }), d)).status).toBe(413);
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("asks for a key when none is sent", async () => {
    const res = await handleSpell(post({ words: ["a"] }, { key: null }), deps());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("needs_api_key");
  });

  it("rate-limits per key", async () => {
    const d = deps({ requestsPerMinute: 1 });
    expect((await handleSpell(post({ words: ["a"] }), d)).status).toBe(200);
    const res = await handleSpell(post({ words: ["a"] }), d);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    // A different key still works.
    expect((await handleSpell(post({ words: ["a"] }, { key: "AIzaSyOTHER-key_9876543210" }), d)).status).toBe(200);
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
    const res = await handleSpell(post({ words: ["a"] }), deps({}, generate));
    expect(res.status).toBe(status);
    expect(((await res.json()) as { code: string }).code).toBe(code);
  });
});
