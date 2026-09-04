import { Redis } from "@upstash/redis";

export interface RateLimiter {
  check(
    key: string,
    limit: number,
    windowMs: number,
    now?: number,
  ): Promise<boolean>;
}

// @spec TRIP-API-010, TRIP-API-011, TRIP-API-012, COND-API-012, SEC-DATA-004
export function createMemoryRateLimiter(): RateLimiter {
  const entries = new Map<string, { count: number; expires: number }>();
  return {
    async check(key, limit, windowMs, now = Date.now()) {
      const existing = entries.get(key);
      const entry =
        !existing || existing.expires <= now
          ? { count: 0, expires: now + windowMs }
          : existing;
      entry.count += 1;
      entries.set(key, entry);
      return entry.count <= limit;
    },
  };
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

function createRedisRateLimiter(): RateLimiter {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Rate-limit storage is not configured");
  const redis = new Redis({ url, token });
  return {
    async check(key, limit, windowMs) {
      const count = await redis.eval<string[], number>(
        RATE_LIMIT_SCRIPT,
        [`rate:v1:${key}`],
        [String(windowMs)],
      );
      return count <= limit;
    },
  };
}

// Production rate limits must be shared across serverless instances. The Redis
// client is created on first request so a production build does not require
// runtime credentials during static analysis.
export function createRateLimiter(): RateLimiter {
  if (process.env.NODE_ENV !== "production") return createMemoryRateLimiter();
  let configured: RateLimiter | null = null;
  return {
    check(key, limit, windowMs, now) {
      configured ??= createRedisRateLimiter();
      return configured.check(key, limit, windowMs, now);
    },
  };
}
