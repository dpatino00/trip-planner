// @vitest-environment node

import { describe, expect, it } from "vitest";

import { applyTripMutation, createTripDocument } from "@/lib/trips/model";
import {
  createTripInputSchema,
  tripDocumentSchema,
  tripMutationRequestSchema,
} from "@/lib/trips/schema";
import { makeSavedPlace, makeTripV2 } from "./fixtures";

const createInput = {
  title: "Kyoto spring",
  startDate: "2027-04-02",
  endDate: "2027-04-07",
  destination: {
    name: "Kyoto",
    locality: "Kyoto Prefecture",
    countryCode: "JP",
    coordinates: { latitude: 35.0116, longitude: 135.7681 },
    timeZone: "Asia/Tokyo",
  },
  homeBase: null,
};

// @spec PLC-DATA-001, PLC-DATA-002, PLC-DATA-003, PLC-DATA-004
// @spec PLC-DATA-005, PLC-DATA-006, PLC-DATA-007, PLC-DATA-008
// @spec TRIP-DATA-001, TRIP-DATA-002, TRIP-DATA-017, TRIP-DATA-018
describe("destination-neutral trip and place schemas", () => {
  it("accepts a schema-version-two trip with embedded places and no images", () => {
    const parsed = tripDocumentSchema.parse(makeTripV2());

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.destination.name).toBe("San Diego");
    expect(parsed.places[0]).not.toHaveProperty("image");
    expect(parsed.places[0].sourceUrl).toMatch(/^https:/);
  });

  it("rejects invalid required place bounds", () => {
    const invalidCases = [
      makeSavedPlace({ name: "" }),
      makeSavedPlace({ coordinates: { latitude: 91, longitude: 0 } }),
      makeSavedPlace({
        tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
      }),
      makeSavedPlace({ durationMinutes: 1 }),
    ];

    for (const place of invalidCases) {
      expect(
        tripDocumentSchema.safeParse(makeTripV2({ places: [place] })).success,
      ).toBe(false);
    }
  });
});

// @spec TRIP-DATA-003, TRIP-DATA-006, TRIP-DATA-011
describe("schema-version-two trip defaults and references", () => {
  it("creates a destination-neutral trip with the approved defaults", () => {
    const trip = createTripDocument(
      createInput,
      new Date("2026-09-01T12:00:00Z"),
    );

    expect(trip).toMatchObject({
      schemaVersion: 2,
      destination: createInput.destination,
      preferences: {
        interests: ["outdoors", "food", "culture", "relaxing"],
        maximumCost: 2,
        pace: "balanced",
        mobility: "standard",
        notes: "",
      },
      places: [],
      proposals: [],
    });
  });

  it("rejects itinerary and favorite references outside the embedded places", () => {
    const invalid = makeTripV2({
      favoritePlaceIds: ["missing"],
      itinerary: [
        {
          id: "item-1",
          placeId: "missing",
          date: "2026-09-30",
          startTime: null,
          durationMinutes: null,
          order: 0,
          notes: "",
          status: "confirmed",
        },
      ],
    });

    expect(tripDocumentSchema.safeParse(invalid).success).toBe(false);
  });
});

// @spec TRIP-DATA-010
it("excludes request credentials and private context from persisted trips", () => {
  const parsed = tripDocumentSchema.parse(makeTripV2());

  for (const privateField of [
    "token",
    "actionKey",
    "browserLocation",
    "referrer",
    "clientIp",
  ]) {
    expect(parsed).not.toHaveProperty(privateField);
  }
});

// @spec PLAN-UI-010
it("marks a manually added itinerary place as confirmed", () => {
  const trip = makeTripV2();
  const changed = applyTripMutation(trip, {
    type: "add-itinerary-item",
    item: {
      placeId: trip.places[0].id,
      date: trip.startDate,
      startTime: null,
      durationMinutes: trip.places[0].durationMinutes,
      notes: "",
      status: "confirmed",
    },
  } as never);

  expect(changed.itinerary[0]).toMatchObject({ status: "confirmed" });
});

// @spec TRIP-API-007
it("accepts only semantic mutations that reference embedded places", () => {
  const valid = tripMutationRequestSchema.safeParse({
    baseVersion: 1,
    mutationId: crypto.randomUUID(),
    mutation: { type: "add-favorite", placeId: "place-balboa-park" },
  });

  expect(valid.success).toBe(true);
});
