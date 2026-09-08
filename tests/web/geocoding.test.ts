// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";

import { geocodeDestination } from "@/lib/geocoding/open-meteo";

afterEach(() => vi.restoreAllMocks());

it("parses Open-Meteo location results", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      results: [
        {
          name: "San Diego",
          latitude: 32.7157,
          longitude: -117.1611,
          admin1: "California",
          country_code: "US",
          timezone: "America/Los_Angeles",
        },
      ],
    }),
  );

  await expect(geocodeDestination("San Diego, CA")).resolves.toEqual([
    {
      name: "San Diego",
      locality: "California",
      countryCode: "US",
      coordinates: { latitude: 32.7157, longitude: -117.1611 },
      timeZone: "America/Los_Angeles",
    },
  ]);
});

it("filters malformed location results and preserves multiple matches", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      results: [
        { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
        { name: "Bad result", latitude: "not-a-number", longitude: 1 },
        { name: "Paris", latitude: 33.66, longitude: -95.55 },
      ],
    }),
  );

  await expect(geocodeDestination("Paris")).resolves.toHaveLength(2);
});

it("surfaces provider failures", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 503 }),
  );

  await expect(geocodeDestination("San Diego")).rejects.toThrow(
    "Open-Meteo returned 503",
  );
});
