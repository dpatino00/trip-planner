import { Redis } from "@upstash/redis";

import type { StoredTrip, TripRepository } from "@/lib/trips/repository-memory";

const UPDATE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return {0, ''} end
local decoded = cjson.decode(current)
if decoded.trip.version ~= tonumber(ARGV[1]) then return {0, current} end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return {1, ARGV[2]}
`;

// @spec OPS-PROC-005, TRIP-BE-004
export function createTripRepository(): TripRepository {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Trip storage is not configured");
    throw new Error(
      "Set Upstash variables or inject the development memory repository",
    );
  }
  const redis = new Redis({ url, token });
  return {
    async create(key, value) {
      const seconds = Math.max(
        1,
        Math.floor((Date.parse(value.trip.expiresAt) - Date.now()) / 1000),
      );
      return (await redis.set(key, value, { nx: true, ex: seconds })) === "OK";
    },
    async get(key) {
      return await redis.get<StoredTrip>(key);
    },
    async update(key, expectedVersion, value) {
      const response = (await (redis as any).eval(
        UPDATE_SCRIPT,
        [key],
        [String(expectedVersion), JSON.stringify(value)],
      )) as [number, string];
      return {
        ok: response[0] === 1,
        latest: response[1] ? (JSON.parse(response[1]) as StoredTrip) : null,
      };
    },
    async delete(key) {
      return (await redis.del(key)) > 0;
    },
  };
}
