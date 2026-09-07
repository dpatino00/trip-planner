import type { TripDocument } from "@/lib/types";

export interface TripChatContext {
  title: string;
  destination: TripDocument["destination"];
  dates: { start: string; end: string };
  preferences: TripDocument["preferences"];
  places: Array<{
    id: string;
    name: string;
    summary: string;
    locality: string | null;
    interests: string[];
    tags: string[];
    profile: string;
    sourceUrl: string | null;
  }>;
  itinerary: Array<{
    date: string;
    startTime: string | null;
    status: string;
    place: string;
  }>;
  pendingProposal: { summary: string; changes: string[] } | null;
}

function compactText(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

// @spec CHAT-DATA-003, CHAT-BE-011
export function buildTripChatContext(trip: TripDocument): TripChatContext {
  const names = new Map(trip.places.map((place) => [place.id, place.name]));
  const pending = trip.proposals.find(
    (proposal) => proposal.status === "pending",
  );
  const context: TripChatContext = {
    title: trip.title,
    destination: trip.destination,
    dates: { start: trip.startDate, end: trip.endDate },
    preferences: {
      ...trip.preferences,
      notes: compactText(trip.preferences.notes, 500),
    },
    places: trip.places.slice(0, 20).map((place) => ({
      id: place.id,
      name: place.name,
      summary: compactText(place.summary, 240),
      locality: place.locality,
      interests: place.interests,
      tags: place.tags,
      profile: place.profile,
      sourceUrl: place.sourceUrl,
    })),
    itinerary: trip.itinerary.slice(0, 30).map((item) => ({
      date: item.date,
      startTime: item.startTime,
      status: item.status,
      place: names.get(item.placeId) ?? "Unavailable place",
    })),
    pendingProposal: pending
      ? {
          summary: pending.summary,
          changes: pending.changes
            .slice(0, 10)
            .map((change) => change.rationale),
        }
      : null,
  };

  if (JSON.stringify(context).length <= 12_000) return context;
  return {
    ...context,
    places: context.places.slice(0, 8),
    itinerary: context.itinerary.slice(0, 12),
  };
}
