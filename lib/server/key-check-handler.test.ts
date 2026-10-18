import { describe, expect, it, vi } from "vitest";
import { API_KEY_HEADER } from "../api-types";
import type { checkApiKey } from "../gemini";
import type { ServerConfig } from "./config";
import { handleKeyCheck } from "./key-check-handler";

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

const VALID = "AIzaSyTEST-key_0123456789";

const request = (key?: string | null) =>
  new Request("http://localhost/api/key-check", {
    method: "POST",
    headers: key ? { [API_KEY_HEADER]: key } : {},
  });

describe("handleKeyCheck", () => {
  it("checks the caller's key against the configured model", async () => {
    const check = vi.fn<typeof checkApiKey>(async () => ({ ok: true, model: "test-model" }));
    const res = await handleKeyCheck(request(VALID), { config, check });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, model: "test-model" });
    expect(check.mock.calls[0][0]).toMatchObject({ apiKey: VALID, model: "test-model" });
  });

  it("does not call Gemini when the key is missing or malformed", async () => {
    const check = vi.fn<typeof checkApiKey>(async () => ({ ok: true, model: "test-model" }));
    const missing = await handleKeyCheck(request(), { config, check });
    expect(await missing.json()).toMatchObject({ ok: false });
    const invalid = await handleKeyCheck(request("nope"), { config, check });
    expect(await invalid.json()).toMatchObject({ ok: false });
    expect(check).not.toHaveBeenCalled();
  });
});
