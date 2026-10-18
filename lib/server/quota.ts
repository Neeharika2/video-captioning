import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ServerConfig } from "./config";

export type QuotaDecision =
  | { ok: true; usedSeconds: number; limitSeconds: number }
  | { ok: false; reason: "rate_limited" | "quota_exceeded"; usedSeconds?: number; limitSeconds?: number; retryAfterSec: number };

export interface QuotaStore {
  /** Rate-limit the request, then reserve `seconds` of today's audio quota. */
  reserve(subject: string, seconds: number): Promise<QuotaDecision>;
  /** Give back a reservation when transcription failed. */
  refund(subject: string, seconds: number): Promise<void>;
}

const DAY_TTL_SEC = 2 * 24 * 3600;

function dayKey(subject: string, now = new Date()) {
  return `quota:${subject}:${now.toISOString().slice(0, 10)}`;
}

function secondsUntilUtcMidnight(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

// Atomic check-and-add so parallel chunk uploads can't overshoot the quota.
const RESERVE_LUA = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local add = tonumber(ARGV[1])
if used + add > tonumber(ARGV[2]) then return {0, used} end
local total = redis.call('INCRBY', KEYS[1], add)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return {1, total}
`;

class UpstashQuota implements QuotaStore {
  private redis: Redis;
  private limiter: Ratelimit;
  constructor(private config: ServerConfig) {
    this.redis = new Redis({ url: config.upstashUrl, token: config.upstashToken });
    this.limiter = new Ratelimit({
      redis: this.redis,
      limiter: Ratelimit.slidingWindow(config.requestsPerMinute, "1 m"),
      prefix: "ratelimit:transcribe",
    });
  }

  async reserve(subject: string, seconds: number): Promise<QuotaDecision> {
    const rl = await this.limiter.limit(subject);
    if (!rl.success) {
      return { ok: false, reason: "rate_limited", retryAfterSec: Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)) };
    }
    const limitSeconds = this.config.quotaMinutesPerDay * 60;
    const add = Math.ceil(seconds);
    const [ok, used] = (await this.redis.eval(RESERVE_LUA, [dayKey(subject)], [add, limitSeconds, DAY_TTL_SEC])) as [
      number,
      number,
    ];
    if (!ok) {
      return { ok: false, reason: "quota_exceeded", usedSeconds: used, limitSeconds, retryAfterSec: secondsUntilUtcMidnight() };
    }
    return { ok: true, usedSeconds: used, limitSeconds };
  }

  async refund(subject: string, seconds: number) {
    await this.redis.decrby(dayKey(subject), Math.ceil(seconds));
  }
}

/** Per-process store for local dev. Not shared between serverless instances. */
export class MemoryQuota implements QuotaStore {
  private used = new Map<string, number>();
  private hits = new Map<string, number[]>();
  constructor(private config: ServerConfig, private now: () => number = Date.now) {}

  async reserve(subject: string, seconds: number): Promise<QuotaDecision> {
    const t = this.now();
    const recent = (this.hits.get(subject) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= this.config.requestsPerMinute) {
      return { ok: false, reason: "rate_limited", retryAfterSec: Math.ceil((recent[0] + 60_000 - t) / 1000) };
    }
    recent.push(t);
    this.hits.set(subject, recent);

    const key = dayKey(subject, new Date(t));
    const limitSeconds = this.config.quotaMinutesPerDay * 60;
    const used = this.used.get(key) ?? 0;
    const add = Math.ceil(seconds);
    if (used + add > limitSeconds) {
      return {
        ok: false,
        reason: "quota_exceeded",
        usedSeconds: used,
        limitSeconds,
        retryAfterSec: secondsUntilUtcMidnight(new Date(t)),
      };
    }
    this.used.set(key, used + add);
    return { ok: true, usedSeconds: used + add, limitSeconds };
  }

  async refund(subject: string, seconds: number) {
    const key = dayKey(subject, new Date(this.now()));
    this.used.set(key, Math.max(0, (this.used.get(key) ?? 0) - Math.ceil(seconds)));
  }
}

let store: QuotaStore | undefined;
let warned = false;

export function getQuotaStore(config: ServerConfig): QuotaStore {
  if (store) return store;
  if (config.upstashUrl && config.upstashToken) {
    store = new UpstashQuota(config);
  } else {
    if (config.isProduction && !warned) {
      warned = true;
      console.warn("[quota] UPSTASH_REDIS_REST_URL/TOKEN not set; using per-instance memory quota.");
    }
    store = new MemoryQuota(config);
  }
  return store;
}

/** Test helper. */
export function resetQuotaStore(next?: QuotaStore) {
  store = next;
}
