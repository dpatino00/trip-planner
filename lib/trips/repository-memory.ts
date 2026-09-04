import type { LegacyTripDocument, TripDocument } from "@/lib/types";

export interface StoredTrip {
  trip: TripDocument | LegacyTripDocument;
  recentMutationIds: string[];
}
export interface TripRepository {
  create(key: string, value: StoredTrip): Promise<boolean>;
  get(key: string): Promise<StoredTrip | null>;
  update(
    key: string,
    expectedVersion: number,
    value: StoredTrip,
  ): Promise<{ ok: boolean; latest: StoredTrip | null }>;
  delete(key: string): Promise<boolean>;
}

// @spec TRIP-BE-003, TRIP-BE-004
export function createMemoryTripRepository(): TripRepository {
  const values = new Map<string, StoredTrip>();
  return {
    async create(key, value) {
      if (values.has(key)) return false;
      values.set(key, structuredClone(value));
      return true;
    },
    async get(key) {
      const value = values.get(key);
      if (!value || Date.parse(value.trip.expiresAt) <= Date.now()) return null;
      return structuredClone(value);
    },
    async update(key, expectedVersion, value) {
      const latest = values.get(key) ?? null;
      if (!latest || latest.trip.version !== expectedVersion)
        return { ok: false, latest: latest ? structuredClone(latest) : null };
      values.set(key, structuredClone(value));
      return { ok: true, latest: structuredClone(value) };
    },
    async delete(key) {
      return values.delete(key);
    },
  };
}

const developmentState = globalThis as typeof globalThis & {
  tripCompanionRepository?: TripRepository;
};

// @spec TRIP-API-001, TRIP-API-002
export function getDevelopmentTripRepository(): TripRepository {
  return (developmentState.tripCompanionRepository ??=
    createMemoryTripRepository());
}
