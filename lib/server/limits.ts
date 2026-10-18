import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ServerConfig } from "./config";

/**
 * Request-rate limiting only. Gemini spend belongs to the visitor's own API key,
 * so there is no shared daily audio budget: the limiter is just friction against
 * runaway loops and abuse.
 *
 * Subjects are opaque ids (a hash of the key), never the key itself, and are
 * scoped per endpoint so spelling batches don't eat transcription's allowance.
 */
export type RateLimitDecision = { ok: true } | { ok: false; retryAfterSec: number };

export interface RateLimiter {
  limit(subject: string): Promise<RateLimitDecision>;
}

const WINDOW_MS = 60_000;

class UpstashLimiter implements RateLimiter {
  private limiter: Ratelimit;
  constructor(private config: ServerConfig) {
    const redis = new Redis({ url: config.upstashUrl, token: config.upstashToken });
    this.limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.requestsPerMinute, "1 m"),
      prefix: "ratelimit",
    });
  }

  async limit(subject: string): Promise<RateLimitDecision> {
    const rl = await this.limiter.limit(subject);
    if (rl.success) return { ok: true };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)) };
  }
}

/** Per-process limiter for local dev. Not shared between serverless instances. */
export class MemoryLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private config: ServerConfig, private now: () => number = Date.now) {}

  async limit(subject: string): Promise<RateLimitDecision> {
    const t = this.now();
    const recent = (this.hits.get(subject) ?? []).filter((x) => t - x < WINDOW_MS);
    if (recent.length >= this.config.requestsPerMinute) {
      return { ok: false, retryAfterSec: Math.ceil((recent[0] + WINDOW_MS - t) / 1000) };
    }
    recent.push(t);
    this.hits.set(subject, recent);
    return { ok: true };
  }
}

let limiter: RateLimiter | undefined;
let warned = false;

export function getRateLimiter(config: ServerConfig): RateLimiter {
  if (limiter) return limiter;
  if (config.upstashUrl && config.upstashToken) {
    limiter = new UpstashLimiter(config);
  } else {
    if (config.isProduction && !warned) {
      warned = true;
      console.warn("[limits] UPSTASH_REDIS_REST_URL/TOKEN not set; using a per-instance memory rate limit.");
    }
    limiter = new MemoryLimiter(config);
  }
  return limiter;
}

/** Test helper. */
export function resetRateLimiter(next?: RateLimiter) {
  limiter = next;
}
