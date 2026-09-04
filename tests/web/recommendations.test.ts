import { describe, expect, it } from "vitest";

import {
  classifyDaypart,
  haversineMiles,
  rankPlaces,
  scoreConditions,
  scoreDistance,
  scorePlace,
  scorePreference,
  scoreTime,
} from "@/lib/recommendations/scoring";
import {
  makeConditionsV2,
  makePlace,
  makeSavedPlace,
  makeTripV2,
  makeZone,
} from "./fixtures";

// @spec REC-BE-001, REC-BE-002
describe("preference scoring", () => {
  it("combines the four bounded components into a 0-100 score", () => {
    expect(scorePreference(makeSavedPlace(), makeTripV2().preferences)).toBe(
      35,
    );
    expect(
      scorePreference(
        makePlace({
          interests: ["history"],
          costLevel: 3,
          durationMinutes: 301,
        }),
        {
          interests: ["food"],
          maximumCost: 2,
          pace: "balanced",
          mobility: "standard",
        },
      ),
    ).toBe(0);
    expect(
      scorePlace(
        makeSavedPlace(),
        makeTripV2(),
        makeConditionsV2(),
        new Date(),
        null,
      ).score,
    ).toBeGreaterThanOrEqual(0);
  });

  it("uses the neutral interest value when no interests are selected", () => {
    expect(
      scorePreference(makePlace(), {
        interests: [],
        maximumCost: 3,
        pace: "full",
        mobility: "standard",
      }),
    ).toBe(24);
  });
});

// @spec REC-BE-003, REC-BE-013, REC-BE-014, REC-BE-015, REC-BE-016
describe("outdoor condition penalties", () => {
  it.each([
    [10, 0],
    [11, 4],
    [31, 10],
    [61, 18],
  ])(
    "subtracts the precipitation band for %s%%",
    (precipitationProbability, penalty) => {
      const score = scoreConditions(
        makePlace({ profile: "outdoor" }),
        makeZone({ precipitationProbability }),
        null,
      );
      expect(score.value).toBe(30 - penalty);
    },
  );

  it("applies exact temperature, wind, and AQI boundary penalties", () => {
    const score = scoreConditions(
      makePlace({ profile: "outdoor" }),
      makeZone({ temperatureF: 54, windMph: 26, usAqi: 151 }),
      null,
    );
    expect(score.value).toBe(2);
    expect(score.cautions).toEqual(
      expect.arrayContaining([
        "temperature-mismatch",
        "wind-exposed",
        "air-quality",
      ]),
    );
  });
});

// @spec REC-BE-017, REC-BE-018, REC-BE-019
describe("coastal, indoor, and mixed conditions", () => {
  it("applies water-contact wave bands without calling them safety scores", () => {
    expect(
      scoreConditions(
        makePlace({ profile: "coastal", waterContact: true }),
        makeZone(),
        { status: "live", waveHeightFt: 6.1 },
      ).value,
    ).toBe(20);
  });

  it("rewards indoor suitability during adverse conditions and averages mixed places", () => {
    const adverse = makeZone({
      precipitationProbability: 80,
      temperatureF: 90,
      windMph: 30,
      usAqi: 120,
    });
    expect(
      scoreConditions(makePlace({ profile: "indoor" }), adverse, null).value,
    ).toBe(30);
    const mixed = scoreConditions(
      makePlace({ profile: "mixed" }),
      adverse,
      null,
    ).value;
    expect(mixed).toBe(
      Math.round(
        (30 +
          scoreConditions(makePlace({ profile: "outdoor" }), adverse, null)
            .value) /
          2,
      ),
    );
  });
});

// @spec REC-BE-004, REC-BE-020, REC-BE-021
describe("daypart and daylight scoring", () => {
  it("uses a 90-minute sunset-relative golden hour", () => {
    expect(
      classifyDaypart("2026-09-15T17:30:00-07:00", "2026-09-15T18:50:00-07:00"),
    ).toBe("golden-hour");
    expect(
      classifyDaypart("2026-09-15T18:51:00-07:00", "2026-09-15T18:50:00-07:00"),
    ).toBe("evening");
  });

  it("uses fixed fallback boundaries and non-circular adjacency", () => {
    expect(classifyDaypart("2026-09-15T16:30:00-07:00", null)).toBe(
      "golden-hour",
    );
    expect(scoreTime(["morning"], "midday", true, "outdoor")).toBe(12);
    expect(scoreTime(["morning"], "evening", true, "outdoor")).toBe(6);
    expect(scoreTime(["evening"], "evening", false, "outdoor")).toBe(2);
  });
});

// @spec REC-BE-005, REC-UI-003
describe("distance scoring", () => {
  it.each([
    [2, 15],
    [5, 12],
    [10, 8],
    [20, 4],
    [20.01, 1],
  ])("scores %s miles as %s", (distance, expected) => {
    expect(scoreDistance(distance)).toBe(expected);
  });

  it("uses Haversine distance and a neutral missing origin", () => {
    expect(
      haversineMiles(
        { latitude: 32.7157, longitude: -117.1611 },
        { latitude: 32.7157, longitude: -117.1611 },
      ),
    ).toBe(0);
    expect(scoreDistance(null)).toBe(8);
  });
});

// @spec REC-BE-006, REC-BE-007, REC-UI-005
describe("missing conditions", () => {
  it("uses 18 without making a live-fit claim", () => {
    const recommendation = scorePlace(
      makeSavedPlace(),
      makeTripV2(),
      makeConditionsV2({ status: "unavailable" }),
      new Date("2026-09-15T17:00:00Z"),
      null,
    );
    expect(recommendation.conditionsScore).toBe(18);
    expect(recommendation.reasons).not.toContain("live-conditions");
  });
});

// @spec REC-BE-008, REC-BE-009, REC-BE-010, REC-BE-011, REC-BE-022
describe("ranked recommendation output", () => {
  it("returns six stable results with bounded reasons and penalty cautions", () => {
    const catalog = Array.from({ length: 8 }, (_, index) =>
      makeSavedPlace({
        id: `place-${index}`,
        name: `Place ${String.fromCharCode(72 - index)}`,
      }),
    );
    const results = rankPlaces(
      catalog,
      makeTripV2({ places: catalog }),
      makeConditionsV2(),
      new Date(),
      null,
    );
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.reasons.length <= 3)).toBe(true);
    expect(results.map((result) => result.placeId)).toEqual(
      [...catalog]
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, 6)
        .map((place) => place.id),
    );

    const penalized = scoreConditions(
      makePlace({ profile: "outdoor" }),
      makeZone({ precipitationProbability: 70 }),
      null,
    );
    expect(penalized.cautions).toContain("rain-likely");
  });
});

// @spec REC-BE-012
it("labels marine scoring as advisory suitability", () => {
  const result = scorePlace(
    makeSavedPlace({ profile: "coastal", waterContact: true }),
    makeTripV2(),
    makeConditionsV2(),
    new Date(),
    null,
  );
  expect(result.safetyAssessment).toBeUndefined();
  expect(result.cautions).not.toContain("safe");
});
