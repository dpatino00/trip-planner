import { neighborhoods, places as catalog } from "@/data/places";
import type { LegacyTripDocument, SavedPlace, TripDocument } from "@/lib/types";
import { tripDocumentSchema } from "@/lib/trips/schema";

function fromCatalog(id: string, legacy: LegacyTripDocument): SavedPlace {
  const place = catalog.find((candidate) => candidate.id === id);
  if (!place) {
    return {
      id,
      name: "Unavailable saved place",
      summary: "This place is no longer available in the original catalog.",
      locality: "San Diego, CA",
      coordinates: null,
      interests: [],
      tags: ["unavailable"],
      profile: "mixed",
      waterContact: false,
      preferredDayparts: [],
      durationMinutes: null,
      costLevel: null,
      accessibility: [],
      reservationRecommended: null,
      sourceUrl: null,
      origin: "seed",
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      unavailable: true,
    };
  }
  return {
    id: place.id,
    name: place.name,
    summary: place.description || place.tagline,
    locality: "San Diego, CA",
    coordinates: place.coordinates,
    interests: place.interests,
    tags: [...new Set([place.profile, ...place.interests])].slice(0, 10),
    profile: place.profile,
    waterContact: place.waterContact,
    preferredDayparts: place.preferredDayparts,
    durationMinutes: place.durationMinutes,
    costLevel: place.costLevel,
    accessibility: place.accessibility,
    reservationRecommended: place.reservationRecommended,
    sourceUrl: place.sourceUrl.startsWith("https://") ? place.sourceUrl : null,
    origin: "seed",
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };
}

// @spec TRIP-DATA-013, TRIP-DATA-014, TRIP-DATA-016
export function migrateTripDocument(
  input: TripDocument | LegacyTripDocument,
): TripDocument {
  if (input.schemaVersion === 2) {
    return tripDocumentSchema.parse(input) as TripDocument;
  }

  const placeMap = new Map<string, SavedPlace>();
  const itinerary = input.itinerary.map((item) => {
    if (item.kind === "place") {
      if (!placeMap.has(item.placeId)) {
        placeMap.set(item.placeId, fromCatalog(item.placeId, input));
      }
      const place = placeMap.get(item.placeId)!;
      return {
        id: item.id,
        placeId: item.placeId,
        date: item.date,
        startTime: item.startTime,
        durationMinutes: place.durationMinutes,
        order: item.order,
        notes: item.notes,
        status: "confirmed" as const,
      };
    }
    const placeId = `legacy-custom-${item.id}`;
    placeMap.set(placeId, {
      id: placeId,
      name: item.title,
      summary: item.notes,
      locality: "San Diego, CA",
      coordinates: null,
      interests: [],
      tags: ["custom"],
      profile: "mixed",
      waterContact: false,
      preferredDayparts: [],
      durationMinutes: item.durationMinutes,
      costLevel: null,
      accessibility: [],
      reservationRecommended: null,
      sourceUrl: item.externalUrl?.startsWith("https://")
        ? item.externalUrl
        : null,
      origin: "manual",
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
    return {
      id: item.id,
      placeId,
      date: item.date,
      startTime: item.startTime,
      durationMinutes: item.durationMinutes,
      order: item.order,
      notes: item.notes,
      status: "confirmed" as const,
    };
  });

  for (const id of input.favoritePlaceIds) {
    if (!placeMap.has(id)) placeMap.set(id, fromCatalog(id, input));
  }
  const home = neighborhoods.find(
    (candidate) => candidate.id === input.homeBaseNeighborhoodId,
  );
  return tripDocumentSchema.parse({
    schemaVersion: 2,
    version: input.version,
    title: input.title,
    destination: {
      name: "San Diego",
      locality: "California",
      countryCode: "US",
      coordinates: { latitude: 32.7157, longitude: -117.1611 },
      timeZone: "America/Los_Angeles",
    },
    startDate: input.startDate,
    endDate: input.endDate,
    homeBase: home ? { label: home.name, coordinates: home.coordinates } : null,
    preferences: { ...input.preferences, notes: "" },
    places: [...placeMap.values()],
    favoritePlaceIds: input.favoritePlaceIds,
    itinerary,
    proposals: [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    expiresAt: input.expiresAt,
  }) as TripDocument;
}
