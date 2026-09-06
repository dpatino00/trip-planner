// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createSuggestedPlace } from "@/lib/places/suggested";
import { makeSavedPlace } from "./fixtures";

const candidate = {
  name: "  La Jolla   Cove ",
  summary: "Ocean overlook",
  locality: " La Jolla ",
  interests: ["coast" as const],
  tags: [" Sea Lions ", "sea lions", "bad!"],
  profile: "coastal" as const,
  preferredDayparts: ["morning" as const],
  durationMinutes: 90,
  costLevel: 0 as const,
  reservationRecommended: false,
  sourceUrl: "http://unsafe.example",
  coordinates: { latitude: 999, longitude: -117 },
};

// @spec PLC-DATA-006, PLC-DATA-008, PLC-BE-001, PLC-BE-002, CHAT-DATA-001, CHAT-BE-004
it("normalizes suggestions, applies defaults, and discards unsafe enrichment", () => {
  const result = createSuggestedPlace(candidate, [], {
    clock: () => new Date("2026-09-06T12:00:00Z"),
    idFactory: () => "generated-id",
  });

  expect(result.duplicate).toBeNull();
  expect(result.place).toMatchObject({
    id: "place-generated-id",
    name: "La Jolla Cove",
    locality: "La Jolla",
    tags: ["sea lions"],
    sourceUrl: null,
    coordinates: null,
    waterContact: false,
    accessibility: [],
    origin: "chatgpt",
    createdAt: "2026-09-06T12:00:00.000Z",
  });
  expect(result.warnings).toEqual([
    "Discarded invalid coordinates.",
    "Discarded invalid sourceUrl.",
  ]);
});

// @spec PLC-BE-003, PLC-BE-004, CHAT-BE-005
it("returns a normalized name/locality duplicate without creating a place", () => {
  const existing = makeSavedPlace({
    name: "La Jolla Cove",
    locality: "La Jolla",
  });
  const result = createSuggestedPlace(candidate, [existing], {
    clock: () => new Date(),
    idFactory: () => "unused",
  });

  expect(result.place).toBe(existing);
  expect(result.duplicate).toBe(existing);
  expect(result.warnings).toContain(
    "Duplicate place matched by name and locality.",
  );
});
