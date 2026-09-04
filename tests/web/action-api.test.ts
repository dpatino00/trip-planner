// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createActionHandlers } from "@/lib/actions/handlers";
import { createMemoryRateLimiter } from "@/lib/trips/rate-limit";
import { createMemoryTripRepository } from "@/lib/trips/repository-memory";
import { tripKeyForToken } from "@/lib/trips/token";
import { makeTripV2, NOW, SHARE_TOKEN } from "./fixtures";

const ACTION_KEY = "action-key-with-at-least-thirty-two-bytes";

function actionRequest(
  method: string,
  path: string,
  options: {
    actionKey?: string | null;
    tripToken?: string | null;
    body?: unknown;
    rawBody?: string;
  } = {},
) {
  const headers = new Headers();
  if (options.actionKey !== null) {
    headers.set("authorization", `Bearer ${options.actionKey ?? ACTION_KEY}`);
  }
  if (options.tripToken !== null) {
    headers.set("x-trip-token", options.tripToken ?? SHARE_TOKEN);
  }
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://trip.test${path}`, {
    method,
    headers,
    body:
      options.rawBody ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
}

async function setup(overrides: { actionKey?: string; trip?: any } = {}) {
  const repository = createMemoryTripRepository();
  const trip = overrides.trip ?? makeTripV2();
  await repository.create(tripKeyForToken(SHARE_TOKEN), {
    trip,
    recentMutationIds: [],
  } as never);
  const handlers = createActionHandlers({
    repository,
    rateLimiter: createMemoryRateLimiter(),
    actionKey: overrides.actionKey ?? ACTION_KEY,
    clock: () => NOW,
  });
  return { handlers, repository, trip };
}

function mutationBody(version: number, input: Record<string, unknown> = {}) {
  return { version, mutationId: crypto.randomUUID(), ...input };
}

beforeEach(() => vi.restoreAllMocks());

// @spec ACT-API-001, ACT-API-002, ACT-API-003, ACT-API-004, ACT-API-005
// @spec SEC-API-005
describe("Action authentication and trip context", () => {
  it("requires the Action key before inspecting the trip credential", async () => {
    const { handlers, repository } = await setup();
    const read = vi.spyOn(repository, "get");

    const response = await handlers.getTripContext(
      actionRequest("GET", "/api/actions/trip", { actionKey: null }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("action-auth-invalid");
    expect(read).not.toHaveBeenCalled();
  });

  it("requires a valid trip token only in the approved header", async () => {
    const { handlers, repository } = await setup();
    const read = vi.spyOn(repository, "get");
    const missing = await handlers.getTripContext(
      actionRequest("GET", `/api/actions/trip?token=${SHARE_TOKEN}`, {
        tripToken: null,
      }),
    );
    expect(missing.status).toBe(401);
    expect(read).not.toHaveBeenCalled();

    const unknown = await handlers.getTripContext(
      actionRequest("GET", "/api/actions/trip", { tripToken: "B".repeat(22) }),
    );
    expect(unknown.status).toBe(404);
  });

  it("returns concise current context for both valid credentials", async () => {
    const { handlers, trip } = await setup();
    const response = await handlers.getTripContext(
      actionRequest("GET", "/api/actions/trip"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      title: trip.title,
      destination: trip.destination,
      preferences: trip.preferences,
      version: trip.version,
    });
    expect(body.data.places).toHaveLength(trip.places.length);
  });
});

// @spec PLC-BE-001, PLC-BE-002, PLC-BE-003, PLC-BE-004
// @spec ACT-API-007, ACT-API-008, ACT-BE-003, SEC-API-006
describe("conversational place mutations", () => {
  it("saves a place despite invalid optional enrichment and never fetches its URL", async () => {
    const { handlers, trip } = await setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await handlers.addPlace(
      actionRequest("POST", "/api/actions/trip/places", {
        body: mutationBody(trip.version, {
          place: {
            name: "Nishiki Market",
            locality: "Kyoto",
            sourceUrl: "javascript:alert(1)",
            coordinates: { latitude: 900, longitude: 0 },
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.place).toMatchObject({
      name: "Nishiki Market",
      sourceUrl: null,
      coordinates: null,
      origin: "chatgpt",
    });
    expect(body.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/sourceUrl|coordinates/)]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns an existing exact name-and-locality match as a no-op", async () => {
    const { handlers, trip } = await setup();
    const response = await handlers.addPlace(
      actionRequest("POST", "/api/actions/trip/places", {
        body: mutationBody(trip.version, {
          place: { name: "  balboa PARK ", locality: "san diego, ca" },
        }),
      }),
    );
    const body = await response.json();

    expect(body.tripVersion).toBe(trip.version);
    expect(body.data.place.id).toBe(trip.places[0].id);
    expect(body.warnings.join(" ")).toMatch(/duplicate/i);
  });

  it("updates only allowlisted place fields", async () => {
    const { handlers, trip } = await setup();
    const response = await handlers.updatePlace(
      actionRequest("PATCH", `/api/actions/trip/places/${trip.places[0].id}`, {
        body: mutationBody(trip.version, {
          changes: { summary: "A full afternoon of gardens and museums." },
        }),
      }),
      { placeId: trip.places[0].id },
    );

    expect((await response.json()).data.place.summary).toMatch(/afternoon/);
  });
});

// @spec ACT-API-006, ACT-API-009, ACT-API-010, ACT-API-011
describe("destination, preference, and proposal actions", () => {
  it("updates destination context and preferences through explicit operations", async () => {
    const { handlers, trip } = await setup();
    const destinationResponse = await handlers.setTripDestination(
      actionRequest("POST", "/api/actions/trip/destination", {
        body: mutationBody(trip.version, {
          destination: {
            name: "Kyoto",
            locality: "Kyoto Prefecture",
            countryCode: "JP",
            coordinates: { latitude: 35.0116, longitude: 135.7681 },
            timeZone: "Asia/Tokyo",
          },
        }),
      }),
    );
    const destinationBody = await destinationResponse.json();
    expect(destinationBody.data.destination.name).toBe("Kyoto");

    const preferenceResponse = await handlers.setTripPreferences(
      actionRequest("POST", "/api/actions/trip/preferences", {
        body: mutationBody(destinationBody.tripVersion, {
          preferences: {
            interests: ["food", "culture"],
            maximumCost: 2,
            pace: "relaxed",
            mobility: "standard",
            notes: "One major activity per day.",
          },
        }),
      }),
    );
    expect((await preferenceResponse.json()).data.preferences.pace).toBe(
      "relaxed",
    );
  });

  it("creates and atomically applies a current proposal", async () => {
    const { handlers, trip } = await setup();
    const optimized = await handlers.optimizeTrip(
      actionRequest("POST", "/api/actions/trip/optimize", {
        body: mutationBody(trip.version),
      }),
    );
    const optimizedBody = await optimized.json();
    expect(optimizedBody.proposal.status).toBe("pending");

    const applied = await handlers.applyPlanProposal(
      actionRequest(
        "POST",
        `/api/actions/trip/proposals/${optimizedBody.proposal.id}/apply`,
        {
          body: mutationBody(optimizedBody.tripVersion),
        },
      ),
      { proposalId: optimizedBody.proposal.id },
    );
    expect((await applied.json()).data.proposal.status).toBe("applied");
  });
});

// @spec ACT-API-013, ACT-API-014, SEC-DATA-005
it("returns no-store responses without either credential", async () => {
  const { handlers } = await setup();
  const response = await handlers.getTripContext(
    actionRequest("GET", "/api/actions/trip"),
  );
  const serialized = JSON.stringify(await response.json());

  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(serialized).not.toContain(ACTION_KEY);
  expect(serialized).not.toContain(SHARE_TOKEN);
});

// @spec ACT-API-015, SEC-API-003
it("rejects unknown and oversized Action input before mutation", async () => {
  const { handlers, repository, trip } = await setup();
  const update = vi.spyOn(repository, "update");
  const unknown = await handlers.optimizeTrip(
    actionRequest("POST", "/api/actions/trip/optimize", {
      body: mutationBody(trip.version, { unknown: true }),
    }),
  );
  expect(unknown.status).toBe(400);

  const oversized = await handlers.optimizeTrip(
    actionRequest("POST", "/api/actions/trip/optimize", {
      rawBody: JSON.stringify({ value: "x".repeat(64 * 1024) }),
    }),
  );
  expect(oversized.status).toBe(400);
  expect(update).not.toHaveBeenCalled();
});

// @spec ACT-API-016, ACT-API-017
it("applies separate per-trip Action read and mutation limits", async () => {
  const { handlers, trip } = await setup();
  for (let index = 0; index < 60; index += 1) {
    expect(
      (await handlers.getTripContext(actionRequest("GET", "/api/actions/trip")))
        .status,
    ).toBe(200);
  }
  expect(
    (await handlers.getTripContext(actionRequest("GET", "/api/actions/trip")))
      .status,
  ).toBe(429);

  let version = trip.version;
  for (let index = 0; index < 30; index += 1) {
    const response = await handlers.setTripPreferences(
      actionRequest("POST", "/api/actions/trip/preferences", {
        body: mutationBody(version, { preferences: trip.preferences }),
      }),
    );
    expect(response.status).toBe(200);
    version = (await response.json()).tripVersion;
  }
  expect(
    (
      await handlers.setTripPreferences(
        actionRequest("POST", "/api/actions/trip/preferences", {
          body: mutationBody(version, { preferences: trip.preferences }),
        }),
      )
    ).status,
  ).toBe(429);
});

// @spec ACT-BE-001, ACT-BE-002, TRIP-BE-003, TRIP-BE-004, TRIP-BE-005
it("shares idempotent and versioned mutation behavior with the browser API", async () => {
  const { handlers, trip } = await setup();
  const body = {
    version: trip.version,
    mutationId: crypto.randomUUID(),
    place: { name: "Japanese Friendship Garden", locality: "San Diego, CA" },
  };
  const first = await handlers.addPlace(
    actionRequest("POST", "/api/actions/trip/places", { body }),
  );
  const second = await handlers.addPlace(
    actionRequest("POST", "/api/actions/trip/places", { body }),
  );
  const conflict = await handlers.addPlace(
    actionRequest("POST", "/api/actions/trip/places", {
      body: { ...body, mutationId: crypto.randomUUID() },
    }),
  );

  expect((await first.json()).tripVersion).toBe(trip.version + 1);
  expect((await second.json()).tripVersion).toBe(trip.version + 1);
  expect(conflict.status).toBe(409);
});

// @spec SEC-DATA-006, OPS-PROC-005
it("fails closed when the configured Action key is absent or too short", () => {
  expect(() =>
    createActionHandlers({
      repository: createMemoryTripRepository(),
      rateLimiter: createMemoryRateLimiter(),
      actionKey: "short",
    }),
  ).toThrow(/action key/i);
});
