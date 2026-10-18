import { describe, expect, it } from "vitest";
import type { ServerConfig } from "./config";
import { MemoryLimiter } from "./limits";

const base: ServerConfig = {
  geminiModel: "m",
  spellModel: "t",
  requestsPerMinute: 2,
  maxChunkSeconds: 600,
  maxUploadBytes: 4_400_000,
  upstashUrl: "",
  upstashToken: "",
  isProduction: true,
};

describe("MemoryLimiter", () => {
  it("allows up to the per-minute limit, then reports a retry delay", async () => {
    let now = 0;
    const limiter = new MemoryLimiter(base, () => now);
    expect(await limiter.limit("a")).toEqual({ ok: true });
    expect(await limiter.limit("a")).toEqual({ ok: true });
    const blocked = await limiter.limit("a");
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.retryAfterSec).toBeGreaterThan(0);

    // The window slides: after a minute the oldest hit expires.
    now = 60_001;
    expect(await limiter.limit("a")).toEqual({ ok: true });
  });

  it("tracks subjects independently", async () => {
    const limiter = new MemoryLimiter(base, () => 0);
    await limiter.limit("a");
    await limiter.limit("a");
    expect((await limiter.limit("a")).ok).toBe(false);
    expect((await limiter.limit("b")).ok).toBe(true);
  });
});
