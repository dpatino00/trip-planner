// @vitest-environment node

import { expect, it } from "vitest";

import { migrateTripDocument } from "@/lib/trips/migrate";
import { makeTrip } from "./fixtures";

// @spec TRIP-DATA-013, TRIP-DATA-014, TRIP-DATA-015
it("migrates legacy catalog and custom items without rotating trip identity", () => {
  const legacy = makeTrip({
    itinerary: [
      {
        id: "legacy-place",
        kind: "place",
        placeId: "balboa-park",
        date: "2026-09-15",
        startTime: null,
        order: 0,
        notes: "",
      },
      {
        id: "legacy-custom",
        kind: "custom",
        title: "Dinner with friends",
        date: "2026-09-15",
        startTime: "19:00",
        durationMinutes: 90,
        order: 1,
        notes: "Patio if possible",
        externalUrl: "https://example.com/dinner",
      },
    ],
  });

  const migrated = migrateTripDocument(legacy);

  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.destination).toMatchObject({
    name: "San Diego",
    timeZone: "America/Los_Angeles",
  });
  expect(migrated.places).toHaveLength(2);
  expect(migrated.itinerary).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "confirmed" })]),
  );
});

// @spec TRIP-DATA-016
it("retains an unavailable placeholder for an unknown legacy place", () => {
  const legacy = makeTrip({
    itinerary: [
      {
        id: "legacy-missing",
        kind: "place",
        placeId: "removed-place",
        date: "2026-09-15",
        startTime: null,
        order: 0,
        notes: "",
      },
    ],
  });

  const migrated = migrateTripDocument(legacy);

  expect(migrated.itinerary).toHaveLength(1);
  expect(migrated.places[0]).toMatchObject({
    id: "removed-place",
    unavailable: true,
  });
});
