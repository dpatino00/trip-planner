// @vitest-environment node

import { describe, expect, it } from "vitest";

import { applyTripMutation } from "@/lib/trips/model";
import { buildPlanProposal } from "@/lib/trips/optimizer";
import { makeTripV2, NOW } from "./fixtures";

function plannedTrip() {
  return makeTripV2({
    itinerary: [
      {
        id: "fixed",
        placeId: "place-balboa-park",
        date: "2026-09-15",
        startTime: "10:00",
        durationMinutes: 180,
        order: 0,
        notes: "Keep this museum booking.",
        status: "confirmed",
      },
      {
        id: "flexible",
        placeId: "place-tacos",
        date: "2026-09-16",
        startTime: null,
        durationMinutes: 60,
        order: 0,
        notes: "",
        status: "tentative",
      },
    ],
  });
}

// @spec OPT-DATA-001, OPT-DATA-002
// @spec OPT-BE-001, OPT-BE-002, OPT-BE-003, OPT-BE-004, OPT-BE-005
// @spec OPT-BE-010
describe("deterministic optimization", () => {
  it("proposes only explained, allowed changes and keeps confirmed items fixed", () => {
    const trip = plannedTrip();
    const first = buildPlanProposal(trip, { conditions: null, now: NOW });
    const second = buildPlanProposal(trip, { conditions: null, now: NOW });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      baseVersion: trip.version,
      status: "pending",
    });
    expect(first?.changes.length).toBeLessThanOrEqual(10);
    expect(first?.changes.length).toBeGreaterThan(0);
    expect(
      first?.changes.every((change: any) => change.rationale.length > 0),
    ).toBe(true);
    expect(
      first?.changes.every((change: any) =>
        ["add-item", "move-tentative-item", "reorder-tentative-items"].includes(
          change.type,
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(
      /opening hours|travel time|reservation available|booking available/i,
    );
    expect(
      trip.itinerary.find((item: any) => item.id === "fixed"),
    ).toMatchObject({ date: "2026-09-15", startTime: "10:00", order: 0 });
  });

  it("keeps places with missing coordinates eligible using neutral inputs", () => {
    const allPlaces = makeTripV2().places;
    const trip = makeTripV2({
      places: [allPlaces.find((place: any) => place.id === "place-cabrillo")],
    });
    const proposal = buildPlanProposal(trip, { conditions: null, now: NOW });

    expect(proposal?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "add-item",
          placeId: "place-cabrillo",
        }),
      ]),
    );
  });
});

// @spec TRIP-DATA-012, OPT-BE-006, OPT-BE-007
it("supersedes old proposals, retains three, and stores nothing for no-op input", () => {
  const proposal = buildPlanProposal(plannedTrip(), {
    conditions: null,
    now: NOW,
  });
  const old = ["one", "two", "three"].map((id, index) => ({
    id,
    baseVersion: index + 1,
    status: "pending",
    summary: `Old proposal ${id}`,
    changes: [],
    createdAt: `2026-09-0${index + 1}T12:00:00.000Z`,
  }));
  const stored = applyTripMutation(makeTripV2({ proposals: old }), {
    type: "store-plan-proposal",
    proposal,
  } as never);

  expect(stored.proposals).toHaveLength(3);
  expect(
    stored.proposals.filter((item: any) => item.status === "pending"),
  ).toHaveLength(1);
  expect(
    buildPlanProposal(makeTripV2({ places: [] }), {
      conditions: null,
      now: NOW,
    }),
  ).toBeNull();
});

// @spec OPT-BE-008, OPT-BE-009, OPT-BE-011, OPT-BE-012, OPT-BE-013
describe("proposal decisions", () => {
  it("dismisses without changing itinerary", () => {
    const proposal = buildPlanProposal(plannedTrip(), {
      conditions: null,
      now: NOW,
    });
    const trip = makeTripV2({ proposals: [proposal] });
    const dismissed = applyTripMutation(trip, {
      type: "dismiss-plan-proposal",
      proposalId: proposal?.id,
    } as never);

    expect(dismissed.itinerary).toEqual(trip.itinerary);
    expect(dismissed.proposals[0].status).toBe("dismissed");
  });

  it("atomically applies current changes as tentative and rejects stale proposals", () => {
    const proposal = buildPlanProposal(makeTripV2(), {
      conditions: null,
      now: NOW,
    });
    const trip = makeTripV2({ proposals: [proposal] });
    const applied = applyTripMutation(trip, {
      type: "apply-plan-proposal",
      proposalId: proposal?.id,
    } as never);

    expect(applied.proposals[0].status).toBe("applied");
    expect(
      applied.itinerary.every((item: any) => item.status === "tentative"),
    ).toBe(true);

    expect(() =>
      applyTripMutation(makeTripV2({ version: 2, proposals: [proposal] }), {
        type: "apply-plan-proposal",
        proposalId: proposal?.id,
      } as never),
    ).toThrow(/version|stale/i);
  });
});
