import type { TripDocument } from "@/lib/types";

export interface TripChatContext {
  title: string;
  destination: TripDocument["destination"];
  dates: { start: string; end: string };
  today?: string;
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

function localDate(now: Date, timeZone: string | null) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function compactText(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function normalizedSearchText(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function prioritizeMentionedPlaces(
  places: TripDocument["places"],
  relevantText: string,
) {
  const searchable = ` ${normalizedSearchText(relevantText)} `;
  const mentioned = places.filter((place) => {
    const name = normalizedSearchText(place.name);
    return name.length > 0 && searchable.includes(` ${name} `);
  });
  if (mentioned.length === 0) return places;
  const mentionedIds = new Set(mentioned.map((place) => place.id));
  return [
    ...mentioned,
    ...places.filter((place) => !mentionedIds.has(place.id)),
  ];
}

// @spec CHAT-DATA-003, CHAT-BE-011, CHAT-BE-042
export function buildTripChatContext(
  trip: TripDocument,
  now = new Date(),
  relevantText = "",
): TripChatContext {
  const names = new Map(trip.places.map((place) => [place.id, place.name]));
  const prioritizedPlaces = prioritizeMentionedPlaces(
    trip.places,
    relevantText,
  );
  const pending = trip.proposals.find(
    (proposal) => proposal.status === "pending",
  );
  const context: TripChatContext = {
    title: trip.title,
    destination: trip.destination,
    dates: { start: trip.startDate, end: trip.endDate },
    today: localDate(now, trip.destination.timeZone),
    preferences: {
      ...trip.preferences,
      notes: compactText(trip.preferences.notes, 500),
    },
    places: prioritizedPlaces.slice(0, 20).map((place) => ({
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
