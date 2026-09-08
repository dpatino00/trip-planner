// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";

import {
  catalogAuthConfig,
  createCatalogSession,
  passwordIsValid,
  sessionIsValid,
} from "@/lib/catalog/auth";
import { createMemoryCatalogRepository } from "@/lib/catalog/repository";
import { createCatalogService } from "@/lib/catalog/service";
import { createMemoryTripRepository } from "@/lib/trips/repository-memory";
import { tripKeyForToken } from "@/lib/trips/token";
import { NOW, SHARE_TOKEN } from "./fixtures";

const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
const input = {
  title: "San Diego escape",
  startDate: "2026-09-14",
  endDate: "2026-09-18",
  destination: {
    name: "San Diego",
    locality: "California",
    countryCode: "US",
    coordinates: null,
    timeZone: "America/Los_Angeles",
  },
};

afterEach(() => vi.unstubAllEnvs());

// @spec CAT-API-001, CAT-API-002, CAT-SEC-001, CAT-SEC-002
it("validates the shared password and signs a thirty-day catalog session", () => {
  vi.stubEnv("TRIP_CATALOG_PASSWORD", "shared password");
  vi.stubEnv("TRIP_CATALOG_SESSION_SECRET", "session secret");
  vi.stubEnv("TRIP_CATALOG_ENCRYPTION_KEY", encryptionKey);
  const config = catalogAuthConfig();
  expect(config).not.toBeNull();
  expect(passwordIsValid("shared password", config!)).toBe(true);
  expect(passwordIsValid("wrong", config!)).toBe(false);
  const session = createCatalogSession(config!, NOW.getTime());
  expect(sessionIsValid(session, config!, NOW.getTime())).toBe(true);
  expect(
    sessionIsValid(session, config!, NOW.getTime() + 31 * 86_400_000),
  ).toBe(false);
});

// @spec CAT-DATA-001, CAT-API-003, CAT-API-004, CAT-BE-001, CAT-BE-002, CAT-BE-003, CAT-SEC-003
it("registers, lists, and permanently deletes catalog-created trips", async () => {
  const tripRepository = createMemoryTripRepository();
  const catalogRepository = createMemoryCatalogRepository();
  const service = createCatalogService({
    tripRepository,
    catalogRepository,
    encryptionKey,
    clock: () => NOW,
    tokenFactory: () => SHARE_TOKEN,
    idFactory: () => "catalog-trip",
  });

  const created = await service.create(input);
  expect(created.token).toBe(SHARE_TOKEN);
  const stored = await catalogRepository.get();
  expect(JSON.stringify(stored)).not.toContain(SHARE_TOKEN);

  expect(await service.list()).toEqual([
    expect.objectContaining({
      id: "catalog-trip",
      token: SHARE_TOKEN,
      title: "San Diego escape",
      status: "active",
    }),
  ]);
  expect(await service.delete("catalog-trip")).toBe(true);
  expect(await service.list()).toEqual([]);
  expect(await tripRepository.get(tripKeyForToken(SHARE_TOKEN))).toBeNull();
});

// @spec CAT-API-005
it("imports an existing private trip without changing it", async () => {
  const tripRepository = createMemoryTripRepository();
  const catalogRepository = createMemoryCatalogRepository();
  const source = createCatalogService({
    tripRepository,
    catalogRepository,
    encryptionKey,
    clock: () => NOW,
    tokenFactory: () => SHARE_TOKEN,
    idFactory: () => "source",
  });
  const created = await source.create(input);
  await source.removeByToken(SHARE_TOKEN);

  const imported = await source.import(`https://trip.test/trip#${SHARE_TOKEN}`);

  expect(imported.trip).toEqual(created.trip);
  expect(await source.list()).toEqual([
    expect.objectContaining({ token: SHARE_TOKEN, title: "San Diego escape" }),
  ]);
  expect(await tripRepository.get(tripKeyForToken(SHARE_TOKEN))).toEqual({
    trip: created.trip,
    recentMutationIds: [],
  });
});

// @spec CAT-BE-003
it("removes the registry record after a direct private-link deletion", async () => {
  const service = createCatalogService({
    tripRepository: createMemoryTripRepository(),
    catalogRepository: createMemoryCatalogRepository(),
    encryptionKey,
    clock: () => NOW,
    tokenFactory: () => SHARE_TOKEN,
    idFactory: () => "catalog-trip",
  });
  await service.create(input);
  await service.removeByToken(SHARE_TOKEN);
  expect(await service.list()).toEqual([]);
});

// @spec CAT-BE-004
it("keeps an entry deletable when its token cannot be decrypted", async () => {
  const tripRepository = createMemoryTripRepository();
  const catalogRepository = createMemoryCatalogRepository();
  const original = createCatalogService({
    tripRepository,
    catalogRepository,
    encryptionKey,
    clock: () => NOW,
    tokenFactory: () => SHARE_TOKEN,
    idFactory: () => "legacy-entry",
  });
  await original.create(input);
  const changedKey = Buffer.alloc(32, 8).toString("base64url");
  const catalog = createCatalogService({
    tripRepository,
    catalogRepository,
    encryptionKey: changedKey,
    clock: () => NOW,
  });

  expect(await catalog.list()).toEqual([
    expect.objectContaining({
      id: "legacy-entry",
      token: null,
      status: "unavailable",
    }),
  ]);
  expect(await catalog.delete("legacy-entry")).toBe(true);
  expect(await tripRepository.get(tripKeyForToken(SHARE_TOKEN))).toBeNull();
});
