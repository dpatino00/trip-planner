import { describe, expect, it } from "vitest";

import { applyTripMutation, calculateTripExpiry } from "@/lib/trips/model";
import { makeTripV2 } from "./fixtures";

// @spec TRIP-DATA-008, TRIP-DATA-009
describe("absolute trip expiry", () => {
  it("uses the later expiry and does not roll it forward on mutation", () => {
    const createdAt = new Date("2026-09-01T12:00:00Z");
    expect(calculateTripExpiry(createdAt, "2026-09-18")).toBe(
      "2027-03-17T06:59:59.999Z",
    );

    const original = makeTripV2();
    const updated = applyTripMutation(original, {
      type: "add-favorite",
      placeId: original.places[0].id,
    } as never);
    expect(updated.expiresAt).toBe(original.expiresAt);
  });
});

// @spec TRIP-BE-008
it("treats repeat favorite changes as idempotent no-ops", () => {
  const placeId = "place-balboa-park";
  const trip = makeTripV2({ favoritePlaceIds: [placeId] });
  expect(
    applyTripMutation(trip, { type: "add-favorite", placeId } as never)
      .favoritePlaceIds,
  ).toEqual([placeId]);
  expect(
    applyTripMutation(makeTripV2(), {
      type: "remove-favorite",
      placeId,
    } as never).favoritePlaceIds,
  ).toEqual([]);
});

// @spec EXP-BE-006
it("removes an idea, its favorite, and all of its planned stops together", () => {
  const trip = makeTripV2({
    favoritePlaceIds: ["place-balboa-park"],
    itinerary: [
      {
        id: "balboa-stop",
        placeId: "place-balboa-park",
        date: "2026-09-15",
        startTime: null,
        durationMinutes: 180,
        order: 0,
        notes: "",
        status: "confirmed",
      },
      {
        id: "tacos-stop",
        placeId: "place-tacos",
        date: "2026-09-15",
        startTime: null,
        durationMinutes: 60,
        order: 1,
        notes: "",
        status: "confirmed",
      },
    ],
  });
  const changed = applyTripMutation(trip, {
    type: "remove-place",
    placeId: "place-balboa-park",
  });

  expect(changed.places.map((place) => place.id)).not.toContain(
    "place-balboa-park",
  );
  expect(changed.favoritePlaceIds).not.toContain("place-balboa-park");
  expect(changed.itinerary.map((item) => item.id)).toEqual(["tacos-stop"]);
});

// @spec PLAN-BE-001, PLAN-BE-003
describe("itinerary mutation validation", () => {
  it("requires a complete day order and an existing update target", () => {
    const trip = makeTripV2({
      itinerary: [
        {
          id: "a",
          placeId: "place-balboa-park",
          date: "2026-09-15",
          startTime: null,
          durationMinutes: 180,
          order: 0,
          notes: "",
          status: "confirmed",
        },
        {
          id: "b",
          placeId: "place-tacos",
          date: "2026-09-15",
          startTime: "19:00",
          durationMinutes: 60,
          order: 1,
          notes: "",
          status: "confirmed",
        },
      ],
    });
    expect(() =>
      applyTripMutation(trip, {
        type: "reorder-itinerary-day",
        date: "2026-09-15",
        orderedItemIds: ["a"],
      } as never),
    ).toThrow();
    expect(() =>
      applyTripMutation(trip, {
        type: "remove-itinerary-item",
        itemId: "missing",
      } as never),
    ).toThrow();
  });

  it("assigns a moved item the next order on its destination day", () => {
    const trip = makeTripV2({
      itinerary: [
        {
          id: "move-me",
          placeId: "place-balboa-park",
          date: "2026-09-15",
          startTime: null,
          durationMinutes: 180,
          order: 0,
          notes: "",
          status: "confirmed",
        },
        {
          id: "already-there",
          placeId: "place-tacos",
          date: "2026-09-16",
          startTime: null,
          durationMinutes: 60,
          order: 0,
          notes: "",
          status: "confirmed",
        },
      ],
    });

    const changed = applyTripMutation(trip, {
      type: "update-itinerary-item",
      itemId: "move-me",
      changes: { date: "2026-09-16" },
    } as never);

    expect(
      changed.itinerary.find((item) => item.id === "move-me"),
    ).toMatchObject({
      date: "2026-09-16",
      order: 1,
    });
  });
});

// @spec PLAN-BE-002
it("rejects a date-range change that strands itinerary items", () => {
  const trip = makeTripV2({
    itinerary: [
      {
        id: "a",
        placeId: "place-balboa-park",
        date: "2026-09-18",
        startTime: null,
        durationMinutes: 180,
        order: 0,
        notes: "",
        status: "confirmed",
      },
    ],
  });
  expect(() =>
    applyTripMutation(trip, {
      type: "update-details",
      title: trip.title,
      startDate: "2026-09-14",
      endDate: "2026-09-17",
      destination: trip.destination,
      homeBase: trip.homeBase,
    } as never),
  ).toThrow(/2026-09-18/);
});
