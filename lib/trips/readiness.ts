import type { TripDocument } from "@/lib/types";

export interface TripReadiness {
  emptyItineraryDays: number;
  tentativeStops: number;
  tentativeReservationStops: number;
  unscheduledFavoriteIdeas: number;
}

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (
    let time = Date.parse(`${start}T00:00:00Z`);
    time <= Date.parse(`${end}T00:00:00Z`);
    time += 86_400_000
  ) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

/** Derives plan follow-ups from the current trip without changing trip data. */
export function getTripReadiness(trip: TripDocument): TripReadiness {
  const plannedPlaceIds = new Set(trip.itinerary.map((item) => item.placeId));
  const placesById = new Map(trip.places.map((place) => [place.id, place]));
  const tentativeStops = trip.itinerary.filter(
    (item) => item.status === "tentative",
  );

  return {
    emptyItineraryDays: datesBetween(trip.startDate, trip.endDate).filter(
      (date) => !trip.itinerary.some((item) => item.date === date),
    ).length,
    tentativeStops: tentativeStops.length,
    tentativeReservationStops: tentativeStops.filter(
      (item) => placesById.get(item.placeId)?.reservationRecommended === true,
    ).length,
    unscheduledFavoriteIdeas: trip.favoritePlaceIds.filter(
      (placeId) => placesById.has(placeId) && !plannedPlaceIds.has(placeId),
    ).length,
  };
}
