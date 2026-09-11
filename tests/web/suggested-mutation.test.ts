// @vitest-environment node

import { expect, it } from "vitest";

import { createTripHandlers } from "@/lib/trips/handlers";
import { createMemoryRateLimiter } from "@/lib/trips/rate-limit";
import { createMemoryTripRepository } from "@/lib/trips/repository-memory";
import { tripKeyForToken } from "@/lib/trips/token";
import { makeTripV2, SHARE_TOKEN } from "./fixtures";

const suggestion = {
  name: "La Jolla Cove",
  summary: "A compact coastal overlook for scenery and local wildlife.",
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

// @spec CHAT-BE-004, CHAT-BE-005, CHAT-BE-014
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

// @spec CHAT-BE-039, CHAT-UI-021
it("atomically saves and schedules a suggested chat candidate once", async () => {
  const { handlers, trip } = await setup();
  const mutationId = "89ec3145-e136-4b67-a154-c5e9a11ec3b8";
  const body = {
    baseVersion: trip.version,
    mutationId,
    mutation: {
      type: "confirm-chat-schedule",
      candidate: {
        savedPlaceId: null,
        suggestion,
        date: "2026-09-15",
        startTime: "09:00",
        durationMinutes: 120,
      },
    },
  };

  const response = await handlers.PATCH(request(body));
  expect(response.status).toBe(200);
  const changed = (await response.json()).trip;
  expect(changed.version).toBe(trip.version + 1);
  expect(changed.places).toHaveLength(trip.places.length + 1);
  const addedPlace = changed.places.at(-1);
  expect(addedPlace).toMatchObject({
    name: suggestion.name,
    origin: "chatgpt",
  });
  expect(changed.itinerary.at(-1)).toMatchObject({
    placeId: addedPlace.id,
    date: "2026-09-15",
    startTime: "09:00",
    durationMinutes: 120,
    notes: "",
    status: "confirmed",
  });

  const replay = await handlers.PATCH(request(body));
  const replayed = (await replay.json()).trip;
  expect(replayed.version).toBe(changed.version);
  expect(replayed.places).toHaveLength(changed.places.length);
  expect(replayed.itinerary).toHaveLength(changed.itinerary.length);
});

// @spec CHAT-BE-040, CHAT-UI-021
it("schedules an existing chat candidate without changing saved places", async () => {
  const { handlers, trip } = await setup();
  const response = await handlers.PATCH(
    request({
      baseVersion: trip.version,
      mutationId: "4fcf798c-31aa-49d9-87d5-43af033b7760",
      mutation: {
        type: "confirm-chat-schedule",
        candidate: {
          savedPlaceId: "place-tacos",
          suggestion: null,
          date: "2026-09-15",
          startTime: "09:00",
          durationMinutes: 120,
        },
      },
    }),
  );

  expect(response.status).toBe(200);
  const changed = (await response.json()).trip;
  expect(changed.places).toEqual(trip.places);
  expect(changed.itinerary.at(-1)).toMatchObject({
    placeId: "place-tacos",
    date: "2026-09-15",
    startTime: "09:00",
    durationMinutes: 120,
    status: "confirmed",
  });
});

// @spec CHAT-BE-039, CHAT-BE-040
it("rejects a confirmed chat schedule outside the trip dates", async () => {
  const { handlers, trip } = await setup();
  const response = await handlers.PATCH(
    request({
      baseVersion: trip.version,
      mutationId: "2c0fe2e9-5f7c-41a5-bc7e-ff4d77710db3",
      mutation: {
        type: "confirm-chat-schedule",
        candidate: {
          savedPlaceId: "place-tacos",
          suggestion: null,
          date: "2026-10-01",
          startTime: "09:00",
          durationMinutes: 120,
        },
      },
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "invalid-mutation" },
  });
});

// @spec CHAT-BE-025, CHAT-BE-026
it("atomically adds a deduplicated batch and treats an all-duplicate batch as a no-op", async () => {
  const { handlers, trip } = await setup();
  const secondSuggestion = {
    ...suggestion,
    name: "La Puerta",
    locality: "Gaslamp",
    summary:
      "A lively Gaslamp Mexican restaurant for a downtown meal. Happy-hour details supplied by the traveler remain unverified.",
    tags: ["mexican", "casual", "gaslamp"],
    sourceUrl: null,
  };
  const response = await handlers.PATCH(
    request({
      baseVersion: trip.version,
      mutationId: "b4fa8888-b7e7-4650-8500-63013f781234",
      mutation: {
        type: "add-suggested-places",
        suggestions: [
          suggestion,
          { ...suggestion, name: "  la jolla cove  ", locality: "la jolla" },
          secondSuggestion,
        ],
      },
    }),
  );

  expect(response.status).toBe(200);
  const addedTrip = (await response.json()).trip;
  expect(addedTrip.version).toBe(trip.version + 1);
  expect(addedTrip.places).toHaveLength(trip.places.length + 2);
  expect(
    addedTrip.places.filter(
      (place: { name: string }) =>
        place.name.trim().toLocaleLowerCase() === "la jolla cove",
    ),
  ).toHaveLength(1);
  expect(addedTrip.places.at(-1)).toMatchObject({
    name: "La Puerta",
    sourceUrl: null,
    origin: "chatgpt",
  });
  expect(addedTrip.itinerary).toEqual(trip.itinerary);

  const allDuplicates = await handlers.PATCH(
    request({
      baseVersion: addedTrip.version,
      mutationId: "76bb73aa-f5b7-4785-b045-adc5e5c23704",
      mutation: {
        type: "add-suggested-places",
        suggestions: [suggestion, secondSuggestion],
      },
    }),
  );
  const duplicatePayload = await allDuplicates.json();
  expect(allDuplicates.status).toBe(200);
  expect(duplicatePayload.trip.version).toBe(addedTrip.version);
  expect(duplicatePayload.trip.places).toHaveLength(addedTrip.places.length);
  expect(duplicatePayload.duplicate).toBe(true);
});

// @spec CHAT-BE-025
it("rejects a bulk suggestion mutation outside the one-to-twelve boundary", async () => {
  const { handlers, trip } = await setup();
  const response = await handlers.PATCH(
    request({
      baseVersion: trip.version,
      mutationId: "72bd6a28-9b0f-4891-b93b-4b3af0e21ac4",
      mutation: {
        type: "add-suggested-places",
        suggestions: Array.from({ length: 13 }, (_, index) => ({
          ...suggestion,
          name: `Place ${index + 1}`,
        })),
      },
    }),
  );
  expect(response.status).toBe(400);
});
