import { Redis } from "@upstash/redis";

export interface CatalogEntry {
  id: string;
  tokenCiphertext: string;
  tokenHash: string;
  title: string;
  destinationName: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface StoredCatalog {
  version: number;
  entries: CatalogEntry[];
}

export interface CatalogRepository {
  get(): Promise<StoredCatalog | null>;
  create(value: StoredCatalog): Promise<boolean>;
  update(
    expectedVersion: number,
    value: StoredCatalog,
  ): Promise<{ ok: boolean; latest: StoredCatalog | null }>;
}

const catalogKey = "trip-catalog:v1";
const UPDATE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return {0, ''} end
local decoded = cjson.decode(current)
if decoded.version ~= tonumber(ARGV[1]) then return {0, current} end
redis.call('SET', KEYS[1], ARGV[2])
return {1, ARGV[2]}
`;

export function createMemoryCatalogRepository(): CatalogRepository {
  let value: StoredCatalog | null = null;
  return {
    async get() {
      return value ? structuredClone(value) : null;
    },
    async create(next) {
      if (value) return false;
      value = structuredClone(next);
      return true;
    },
    async update(expectedVersion, next) {
      if (!value || value.version !== expectedVersion)
        return { ok: false, latest: value ? structuredClone(value) : null };
      value = structuredClone(next);
      return { ok: true, latest: structuredClone(value) };
    },
  };
}

export function createCatalogRepository(): CatalogRepository {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Trip catalog storage is not configured");
  const redis = new Redis({ url, token });
  return {
    async get() {
      return await redis.get<StoredCatalog>(catalogKey);
    },
    async create(value) {
      return (await redis.set(catalogKey, value, { nx: true })) === "OK";
    },
    async update(expectedVersion, value) {
      const response = (await (redis as any).eval(
        UPDATE_SCRIPT,
        [catalogKey],
        [String(expectedVersion), JSON.stringify(value)],
      )) as [number, string | StoredCatalog];
      return {
        ok: response[0] === 1,
        latest: response[1]
          ? typeof response[1] === "string"
            ? (JSON.parse(response[1]) as StoredCatalog)
            : response[1]
          : null,
      };
    },
  };
}
