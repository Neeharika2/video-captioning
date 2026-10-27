import { describe, expect, it, vi } from "vitest";
import { API_KEY_HEADER } from "../api-types";
import { GeminiError } from "../gemini";
import type { generateJson } from "../gemini-text";
import type { PunchlineResponse } from "../punchlines";
import type { ServerConfig } from "./config";
import { MemoryLimiter } from "./limits";
import { handlePunchlines } from "./punchline-handler";

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
  return new Request("http://localhost/api/punchlines", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function generator(json: unknown) {
  return vi.fn<typeof generateJson>(async () => ({ json, latencyMs: 5, attempts: 1 }));
}

function deps(overrides: Partial<ServerConfig> = {}, generate = generator({ punchlines: [] })) {
  const cfg = { ...config, ...overrides };
  return { config: cfg, limiter: new MemoryLimiter(cfg), generate };
}

const CAPTIONS = [
  ["I", "made", "$5000"],
  ["in", "one", "week"],
];

describe("handlePunchlines", () => {
  it("returns checked punchlines per caption, using the caller's key", async () => {
    const generate = generator({
      punchlines: [
        { id: 0, words: [2] },
        { id: 1, words: [8] }, // out of range → rejected
      ],
    });
    const res = await handlePunchlines(post({ captions: CAPTIONS }), deps({}, generate));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PunchlineResponse;
    expect(body.punchlines).toEqual([[2], null]);
    expect(body.rejected).toBe(1);
    expect(body.model).toBe("test-text-model");
    const call = generate.mock.calls[0][0];
    expect(call.model).toBe("test-text-model");
    expect(call.prompt).toContain("0\t0:I 1:made 2:$5000");
    expect(call.apiKey).toBe(TEST_KEY);
  });

  it("validates the request", async () => {
    const d = deps();
    expect((await handlePunchlines(post({ captions: [] }), d)).status).toBe(400);
    expect((await handlePunchlines(post("{oops"), d)).status).toBe(400);
    expect((await handlePunchlines(post({ captions: [["a"]] }, { type: "text/plain" }), d)).status).toBe(415);
    expect((await handlePunchlines(post({ captions: Array(61).fill(["a"]) }), d)).status).toBe(400);
    expect((await handlePunchlines(post({ captions: [["x".repeat(70_000)]] }), d)).status).toBe(413);
    expect(d.generate).not.toHaveBeenCalled();
  });

  it("asks for a key when none is sent", async () => {
    const res = await handlePunchlines(post({ captions: CAPTIONS }, { key: null }), deps());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("needs_api_key");
  });

  it("rate-limits per key", async () => {
    const d = deps({ requestsPerMinute: 1 });
    expect((await handlePunchlines(post({ captions: CAPTIONS }), d)).status).toBe(200);
    const res = await handlePunchlines(post({ captions: CAPTIONS }), d);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    // A different key still works.
    const other = await handlePunchlines(post({ captions: CAPTIONS }, { key: "AIzaSyOTHER-key_9876543210" }), d);
    expect(other.status).toBe(200);
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
    const res = await handlePunchlines(post({ captions: CAPTIONS }), deps({}, generate));
    expect(res.status).toBe(status);
    expect(((await res.json()) as { code: string }).code).toBe(code);
  });
});
