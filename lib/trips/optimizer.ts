import type {
  ConditionsEnvelope,
  PlanProposal,
  SavedPlace,
  TripDocument,
} from "@/lib/types";
import { scorePreference } from "@/lib/recommendations/scoring";

function tripDates(start: string, end: string) {
  const result: string[] = [];
  for (
    let value = Date.parse(`${start}T00:00:00Z`);
    value <= Date.parse(`${end}T00:00:00Z`);
    value += 86_400_000
  ) {
    result.push(new Date(value).toISOString().slice(0, 10));
  }
  return result;
}

function rankedPlaces(trip: TripDocument): SavedPlace[] {
  return [...trip.places].sort(
    (left, right) =>
      scorePreference(right, trip.preferences) -
        scorePreference(left, trip.preferences) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
}

// @spec OPT-DATA-001, OPT-DATA-002
// @spec OPT-BE-001, OPT-BE-002, OPT-BE-003, OPT-BE-004, OPT-BE-005, OPT-BE-010
export function buildPlanProposal(
  trip: TripDocument,
  {
    conditions: _conditions,
    now = new Date(),
  }: { conditions: ConditionsEnvelope | null; now?: Date },
): PlanProposal | null {
  const scheduled = new Set(trip.itinerary.map((item) => item.placeId));
  const candidates = rankedPlaces(trip)
    .filter((place) => !scheduled.has(place.id) && !place.unavailable)
    .slice(0, 10);
  if (!candidates.length) return null;

  const dates = tripDates(trip.startDate, trip.endDate);
  const load = new Map(
    dates.map((date) => [
      date,
      trip.itinerary.filter((item) => item.date === date).length,
    ]),
  );
  const changes = candidates.map((place) => {
    const date = [...dates].sort(
      (left, right) =>
        (load.get(left) ?? 0) - (load.get(right) ?? 0) ||
        left.localeCompare(right),
    )[0];
    load.set(date, (load.get(date) ?? 0) + 1);
    return {
      type: "add-item" as const,
      placeId: place.id,
      date,
      startTime: null,
      rationale: `Adds ${place.name} to an open day based on your saved interests and pace.`,
    };
  });

  return {
    id: `proposal-${trip.version}-${now.getTime()}`,
    baseVersion: trip.version,
    status: "pending",
    summary: `A balanced draft using ${changes.length} saved ${changes.length === 1 ? "place" : "places"}`,
    changes,
    createdAt: now.toISOString(),
  };
}
