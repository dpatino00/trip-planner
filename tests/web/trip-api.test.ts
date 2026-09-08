// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTripHandlers } from "@/lib/trips/handlers";
import { createMemoryRateLimiter } from "@/lib/trips/rate-limit";
import {
  createMemoryTripRepository,
  getDevelopmentTripRepository,
} from "@/lib/trips/repository-memory";
import { generateShareToken, tripKeyForToken } from "@/lib/trips/token";
import { NOW, SHARE_TOKEN } from "./fixtures";

const createBody = {
  title: "San Diego escape",
  startDate: "2026-09-14",
  endDate: "2026-09-18",
  destination: {
    name: "San Diego",
    locality: "California",
    countryCode: "US",
    coordinates: { latitude: 32.7157, longitude: -117.1611 },
    timeZone: "America/Los_Angeles",
  },
  homeBase: { label: "Little Italy", coordinates: null },
};

const preferences = {
  interests: ["outdoors", "food", "culture", "relaxing"],
  maximumCost: 2,
  pace: "relaxed",
  mobility: "standard",
  notes: "Keep afternoons flexible.",
};

function request(
  method: string,
  options: {
    token?: string;
    body?: unknown;
    ip?: string;
    rawBody?: string;
  } = {},
) {
  const headers = new Headers({
    "x-forwarded-for": options.ip ?? "203.0.113.10",
  });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request("https://trip.test/api/trip", {
    method,
    headers,
    body:
      options.rawBody ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
}

function setup(tokenFactory: () => string = () => SHARE_TOKEN) {
  const repository = createMemoryTripRepository();
  const rateLimiter = createMemoryRateLimiter();
  const handlers = createTripHandlers({
    repository,
    rateLimiter,
    clock: () => NOW,
    tokenFactory,
  });
  return { handlers, repository, rateLimiter };
}

async function createTrip(handlers: ReturnType<typeof createTripHandlers>) {
  const response = await handlers.POST(request("POST", { body: createBody }));
  return { response, payload: await response.json() };
}

// @spec TRIP-API-001, TRIP-API-002
describe("trip create and read", () => {
  it("returns a new token/document and reads it with bearer authentication", async () => {
    const { handlers } = setup();
    const { response, payload } = await createTrip(handlers);
    expect(response.status).toBe(201);
    expect(payload.token).toBe(SHARE_TOKEN);
    expect(payload.trip).toMatchObject({
      schemaVersion: 2,
      title: createBody.title,
      destination: createBody.destination,
    });

    const read = await handlers.GET(request("GET", { token: SHARE_TOKEN }));
    expect(read.status).toBe(200);
    expect((await read.json()).trip).toEqual(payload.trip);
  });

  // @spec TRIP-API-001, TRIP-API-002
  it("keeps the development repository stable across route reloads", () => {
    expect(getDevelopmentTripRepository()).toBe(getDevelopmentTripRepository());
  });
});

// @spec TRIP-API-003, TRIP-API-008
it("applies one semantic mutation and returns no-store headers", async () => {
  const { handlers } = setup();
  const { payload } = await createTrip(handlers);
  const response = await handlers.PATCH(
    request("PATCH", {
      token: SHARE_TOKEN,
      body: {
        baseVersion: payload.trip.version,
        mutationId: "90cb919a-cf40-49be-8f0c-cf0556bd8bf7",
        mutation: { type: "set-preferences", preferences },
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).trip.preferences).toEqual(preferences);
});

// @spec TRIP-API-004
it("permanently deletes only with explicit confirmation", async () => {
  const { handlers } = setup();
  await createTrip(handlers);
  const rejected = await handlers.DELETE(
    request("DELETE", { token: SHARE_TOKEN, body: { confirmation: "delete" } }),
  );
  expect(rejected.status).toBe(400);

  const deleted = await handlers.DELETE(
    request("DELETE", { token: SHARE_TOKEN, body: { confirmation: "DELETE" } }),
  );
  expect(deleted.status).toBe(204);
  expect(
    (await handlers.GET(request("GET", { token: SHARE_TOKEN }))).status,
  ).toBe(404);
});

// @spec TRIP-API-005
it("rejects malformed authentication before storage access", async () => {
  const { handlers, repository } = setup();
  const getSpy = vi.spyOn(repository, "get");
  expect((await handlers.GET(request("GET"))).status).toBe(401);
  expect((await handlers.GET(request("GET", { token: "short" }))).status).toBe(
    401,
  );
  expect(getSpy).not.toHaveBeenCalled();
});

// @spec TRIP-API-006
it("returns 404 for an unknown or expired trip", async () => {
  const { handlers } = setup();
  const response = await handlers.GET(request("GET", { token: SHARE_TOKEN }));
  expect(response.status).toBe(404);
});

// @spec TRIP-API-007
it("returns a non-retryable 400 for unknown fields and references", async () => {
  const { handlers } = setup();
  const response = await handlers.POST(
    request("POST", { body: { ...createBody, unknown: true } }),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.retryable).toBe(false);
});

// @spec TRIP-API-009
it("returns retryable 503 when storage fails", async () => {
  const { handlers, repository } = setup();
  vi.spyOn(repository, "create").mockRejectedValueOnce(
    new Error("storage down"),
  );
  const response = await handlers.POST(request("POST", { body: createBody }));
  expect(response.status).toBe(503);
  expect((await response.json()).error.retryable).toBe(true);
});

it("limits trip creation to ten requests per IP per hour", async () => {
  let tokenIndex = 0;
  const { handlers } = setup(() => String(tokenIndex++).padStart(22, "A"));
  for (let index = 0; index < 10; index += 1) {
    const response = await handlers.POST(
      request("POST", { body: createBody, ip: "198.51.100.8" }),
    );
    expect(response.status).toBe(201);
  }
  expect(
    (
      await handlers.POST(
        request("POST", { body: createBody, ip: "198.51.100.8" }),
      )
    ).status,
  ).toBe(429);
});

// @spec TRIP-API-011, TRIP-API-012
describe("authenticated rate limits", () => {
  it("limits reads and writes independently per token and IP", async () => {
    const { handlers } = setup();
    const { payload } = await createTrip(handlers);
    for (let index = 0; index < 120; index += 1) {
      expect(
        (await handlers.GET(request("GET", { token: SHARE_TOKEN }))).status,
      ).toBe(200);
    }
    expect(
      (await handlers.GET(request("GET", { token: SHARE_TOKEN }))).status,
    ).toBe(429);

    let currentVersion = payload.trip.version;
    for (let index = 0; index < 60; index += 1) {
      const response = await handlers.PATCH(
        request("PATCH", {
          token: SHARE_TOKEN,
          body: {
            baseVersion: currentVersion,
            mutationId: crypto.randomUUID(),
            mutation: {
              type: "set-preferences",
              preferences: {
                ...preferences,
                pace: index % 2 === 0 ? "relaxed" : "balanced",
              },
            },
          },
        }),
      );
      expect(response.status).toBe(200);
      currentVersion = (await response.json()).trip.version;
    }
    expect(
      (
        await handlers.PATCH(
          request("PATCH", {
            token: SHARE_TOKEN,
            body: {
              baseVersion: currentVersion,
              mutationId: crypto.randomUUID(),
              mutation: { type: "set-preferences", preferences },
            },
          }),
        )
      ).status,
    ).toBe(429);
  });
});

// @spec TRIP-BE-001, TRIP-BE-002
describe("share token security", () => {
  it("generates 128-bit base64url tokens and hashes storage keys", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(tripKeyForToken(token)).toMatch(/^trip:v1:[a-f0-9]{64}$/);
    expect(tripKeyForToken(token)).not.toContain(token);
  });
});

// @spec TRIP-BE-003, TRIP-BE-004
it("applies mutation IDs once and increments versions atomically", async () => {
  const { handlers } = setup();
  const { payload } = await createTrip(handlers);
  const body = {
    baseVersion: payload.trip.version,
    mutationId: "90cb919a-cf40-49be-8f0c-cf0556bd8bf7",
    mutation: { type: "set-preferences", preferences },
  };
  const first = await handlers.PATCH(
    request("PATCH", { token: SHARE_TOKEN, body }),
  );
  const second = await handlers.PATCH(
    request("PATCH", { token: SHARE_TOKEN, body }),
  );
  expect((await first.json()).trip.version).toBe(payload.trip.version + 1);
  expect((await second.json()).trip.version).toBe(payload.trip.version + 1);
});

// @spec TRIP-BE-005
it("returns the latest document for a stale version", async () => {
  const { handlers } = setup();
  const { payload } = await createTrip(handlers);
  const firstBody = {
    baseVersion: payload.trip.version,
    mutationId: crypto.randomUUID(),
    mutation: { type: "set-preferences", preferences },
  };
  await handlers.PATCH(
    request("PATCH", { token: SHARE_TOKEN, body: firstBody }),
  );
  const conflict = await handlers.PATCH(
    request("PATCH", {
      token: SHARE_TOKEN,
      body: { ...firstBody, mutationId: crypto.randomUUID() },
    }),
  );
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).trip.version).toBe(payload.trip.version + 1);
});

// @spec SEC-API-003
it("rejects bodies above 64 KiB before application parsing", async () => {
  const { handlers, repository } = setup();
  const createSpy = vi.spyOn(repository, "create");
  const response = await handlers.POST(
    request("POST", { rawBody: "{" + "x".repeat(64 * 1024) + "}" }),
  );
  expect(response.status).toBe(413);
  expect(createSpy).not.toHaveBeenCalled();
});
