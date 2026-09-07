// @vitest-environment node

import { expect, it } from "vitest";

import { createTripHandlers } from "@/lib/trips/handlers";
import { createMemoryRateLimiter } from "@/lib/trips/rate-limit";
import { createMemoryTripRepository } from "@/lib/trips/repository-memory";
import { tripKeyForToken } from "@/lib/trips/token";
import { makeTripV2, SHARE_TOKEN } from "./fixtures";

const suggestion = {
  name: "La Jolla Cove",
  summary: "A coastal overlook",
  locality: "La Jolla",
  interests: ["coast", "wildlife"],
  tags: ["coast", "sea lions"],
  profile: "coastal",
  preferredDayparts: ["morning"],
  durationMinutes: 90,
  costLevel: 0,
  reservationRecommended: false,
  sourceUrl: "https://www.sandiego.gov/lifeguards/beaches/cove",
};

async function setup() {
  const repository = createMemoryTripRepository();
  const trip = makeTripV2();
  await repository.create(tripKeyForToken(SHARE_TOKEN), {
    trip,
    recentMutationIds: [],
  });
  return {
    trip,
    handlers: createTripHandlers({
      repository,
      rateLimiter: createMemoryRateLimiter(),
      clock: () => new Date("2026-09-06T12:00:00Z"),
    }),
  };
}

function request(body: unknown) {
  return new Request("https://trip.test/api/trip", {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${SHARE_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// @spec CHAT-BE-004, CHAT-BE-005
it("adds a confirmed suggestion to Ideas only and treats duplicates as no-ops", async () => {
  const { handlers, trip } = await setup();
  const mutationId = "90cb919a-cf40-49be-8f0c-cf0556bd8bf7";
  const added = await handlers.PATCH(
    request({
      baseVersion: trip.version,
      mutationId,
      mutation: { type: "add-suggested-place", suggestion },
    }),
  );
  expect(added.status).toBe(200);
  const addedTrip = (await added.json()).trip;
  expect(addedTrip.places.at(-1)).toMatchObject({
    name: "La Jolla Cove",
    origin: "chatgpt",
    sourceUrl: suggestion.sourceUrl,
  });
  expect(addedTrip.itinerary).toEqual(trip.itinerary);

  const duplicate = await handlers.PATCH(
    request({
      baseVersion: addedTrip.version,
      mutationId: "66fd41e1-b4ea-4e77-91a9-f4c5c88a2932",
      mutation: { type: "add-suggested-place", suggestion },
    }),
  );
  const duplicatePayload = await duplicate.json();
  expect(duplicate.status).toBe(200);
  expect(duplicatePayload.trip.version).toBe(addedTrip.version);
  expect(duplicatePayload.trip.places).toHaveLength(addedTrip.places.length);
  expect(duplicatePayload.duplicate).toBe(true);
});
