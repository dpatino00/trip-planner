import { decryptCatalogToken, encryptCatalogToken } from "@/lib/catalog/crypto";
import type { GeocodingResult } from "@/lib/geocoding/open-meteo";
import type {
  CatalogEntry,
  CatalogRepository,
  StoredCatalog,
} from "@/lib/catalog/repository";
import { migrateTripDocument } from "@/lib/trips/migrate";
import { createTripDocument } from "@/lib/trips/model";
import type { StoredTrip, TripRepository } from "@/lib/trips/repository-memory";
import {
  generateShareToken,
  hashPrivateKey,
  isValidShareToken,
  tripKeyForToken,
} from "@/lib/trips/token";
import type { TripDocument } from "@/lib/types";

export interface CatalogTrip {
  id: string;
  token: string | null;
  title: string;
  destinationName: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  status: "active" | "expired" | "unavailable";
}

interface Dependencies {
  catalogRepository: CatalogRepository;
  tripRepository: TripRepository;
  encryptionKey: string;
  clock?: () => Date;
  tokenFactory?: () => string;
  idFactory?: () => string;
  geocodeDestination?: (name: string) => Promise<GeocodingResult[]>;
}

function entryFor(
  trip: TripDocument,
  token: string,
  encryptionKey: string,
  id: string,
): CatalogEntry {
  return {
    id,
    tokenCiphertext: encryptCatalogToken(token, encryptionKey),
    tokenHash: hashPrivateKey(token),
    title: trip.title,
    destinationName: trip.destination.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    expiresAt: trip.expiresAt,
  };
}

function itemFor(
  entry: CatalogEntry,
  token: string | null,
  now: Date,
): CatalogTrip {
  return {
    id: entry.id,
    token,
    title: entry.title,
    destinationName: entry.destinationName,
    startDate: entry.startDate,
    endDate: entry.endDate,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt,
    status: token
      ? Date.parse(entry.expiresAt) <= now.getTime()
        ? "expired"
        : "active"
      : "unavailable",
  };
}

// @spec CAT-DATA-001, CAT-API-003, CAT-API-004, CAT-API-005, CAT-BE-001, CAT-BE-002, CAT-BE-003, CAT-BE-004
export function createCatalogService({
  catalogRepository,
  tripRepository,
  encryptionKey,
  clock = () => new Date(),
  tokenFactory = generateShareToken,
  idFactory = () => crypto.randomUUID(),
  geocodeDestination,
}: Dependencies) {
  async function change(
    update: (current: StoredCatalog) => StoredCatalog,
  ): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await catalogRepository.get();
      if (!current) {
        const next = update({ version: 1, entries: [] });
        if (await catalogRepository.create(next)) return;
        continue;
      }
      const next = update({ ...current, version: current.version + 1 });
      if ((await catalogRepository.update(current.version, next)).ok) return;
    }
    throw new Error("Trip catalog changed too quickly");
  }

  async function register(trip: TripDocument, token: string) {
    const entry = entryFor(trip, token, encryptionKey, idFactory());
    await change((current) => ({
      ...current,
      entries: [
        ...current.entries.filter(
          (candidate) => candidate.tokenHash !== entry.tokenHash,
        ),
        entry,
      ],
    }));
  }

  return {
    async create(input: unknown) {
      let trip = createTripDocument(input, clock());
      if (geocodeDestination && !trip.destination.coordinates) {
        try {
          const [match] = await geocodeDestination(trip.destination.name);
          if (match) {
            trip = {
              ...trip,
              destination: {
                ...trip.destination,
                locality: match.locality,
                countryCode: match.countryCode,
                coordinates: match.coordinates,
                timeZone: match.timeZone,
              },
            };
          }
        } catch {
          // Location lookup is best effort; trip creation must remain available.
        }
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const token = tokenFactory();
        const stored: StoredTrip = { trip, recentMutationIds: [] };
        if (!(await tripRepository.create(tripKeyForToken(token), stored)))
          continue;
        try {
          await register(trip, token);
          return { token, trip };
        } catch (cause) {
          await tripRepository.delete(tripKeyForToken(token));
          throw cause;
        }
      }
      throw new Error("Could not create the trip");
    },

    async list(): Promise<CatalogTrip[]> {
      const current = await catalogRepository.get();
      if (!current) return [];
      const now = clock();
      return current.entries
        .map((entry) => {
          try {
            return itemFor(
              entry,
              decryptCatalogToken(entry.tokenCiphertext, encryptionKey),
              now,
            );
          } catch {
            return itemFor(entry, null, now);
          }
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async import(tokenOrLink: string) {
      const token = tokenOrLink.includes("#")
        ? (tokenOrLink.split("#").at(-1) ?? "").trim()
        : tokenOrLink.trim();
      if (!isValidShareToken(token))
        throw new Error(
          "Paste a complete private trip link or its 22-character key",
        );
      const stored = await tripRepository.get(tripKeyForToken(token));
      if (!stored) throw new Error("Trip not found or expired");
      const trip = migrateTripDocument(stored.trip);
      await register(trip, token);
      return { token, trip };
    },

    async delete(id: string) {
      const current = await catalogRepository.get();
      const entry = current?.entries.find((item) => item.id === id);
      if (!entry) return false;
      await tripRepository.delete(`trip:v1:${entry.tokenHash}`);
      await change((latest) => ({
        ...latest,
        entries: latest.entries.filter((item) => item.id !== id),
      }));
      return true;
    },

    async removeByToken(token: string) {
      const tokenHash = hashPrivateKey(token);
      await change((current) => ({
        ...current,
        entries: current.entries.filter(
          (entry) => entry.tokenHash !== tokenHash,
        ),
      }));
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
