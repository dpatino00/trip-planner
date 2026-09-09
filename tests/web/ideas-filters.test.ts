import { describe, expect, it } from "vitest";

import {
  activeIdeaFilterCount,
  emptyIdeaFilters,
  filterIdeas,
  readIdeaFilters,
  writeIdeaFilters,
} from "@/lib/ui/ideas-filters";
import { makeSavedPlace } from "./fixtures";

describe("Ideas filters", () => {
  it("matches every supported filter criterion together", () => {
    const matching = makeSavedPlace({
      id: "matching",
      name: "Accessible coastal walk",
      interests: ["coast"],
      costLevel: 0,
      durationMinutes: 60,
      profile: "coastal",
      accessibility: ["step-free"],
      reservationRecommended: true,
    });
    const excluded = makeSavedPlace({
      id: "excluded",
      name: "Similar walk",
      interests: ["coast"],
      costLevel: 0,
      durationMinutes: 60,
      profile: "coastal",
      accessibility: [],
      reservationRecommended: true,
    });
    expect(
      filterIdeas([matching, excluded], ["matching"], {
        search: "coastal",
        interest: "coast",
        cost: "0",
        duration: "short",
        profile: "coastal",
        accessibility: "step-free",
        reservation: true,
        favorites: true,
      }).map((place) => place.id),
    ).toEqual(["matching"]);
  });

  it("uses inclusive duration boundaries and excludes unknown durations", () => {
    const places = [
      makeSavedPlace({ id: "short", durationMinutes: 89 }),
      makeSavedPlace({ id: "medium-start", durationMinutes: 90 }),
      makeSavedPlace({ id: "medium-end", durationMinutes: 180 }),
      makeSavedPlace({ id: "long", durationMinutes: 181 }),
      makeSavedPlace({ id: "unknown", durationMinutes: null }),
    ];
    expect(
      filterIdeas(places, [], { ...emptyIdeaFilters, duration: "medium" }).map(
        (place) => place.id,
      ),
    ).toEqual(["medium-start", "medium-end"]);
  });

  it("round-trips active filters through URL search parameters", () => {
    const filters = {
      search: "gardens",
      interest: "culture",
      cost: "1",
      duration: "medium",
      profile: "mixed",
      accessibility: "low-walking",
      reservation: true,
      favorites: true,
    };
    const params = new URLSearchParams("view=ideas&unrelated=kept");
    expect(readIdeaFilters(writeIdeaFilters(params, filters))).toEqual(filters);
    expect(params.get("view")).toBe("ideas");
    expect(params.get("unrelated")).toBe("kept");
    expect(activeIdeaFilterCount(filters)).toBe(8);
  });

  it("removes cleared filters without changing the selected view", () => {
    const params = new URLSearchParams(
      "view=ideas&search=gardens&reservation=true&favorites=true",
    );
    writeIdeaFilters(params, emptyIdeaFilters);
    expect(params.toString()).toBe("view=ideas");
    expect(activeIdeaFilterCount(emptyIdeaFilters)).toBe(0);
  });
});
