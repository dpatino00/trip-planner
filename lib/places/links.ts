import type { Coordinates } from "@/lib/types";

interface PlaceLinkInput {
  name: string;
  locality: string | null;
  coordinates?: Coordinates | null;
}

// @spec PLC-BE-005
export function createPlaceMapLinks(place: PlaceLinkInput) {
  const label = [place.name, place.locality].filter(Boolean).join(", ");
  const coordinateQuery = place.coordinates
    ? `${place.coordinates.latitude},${place.coordinates.longitude}`
    : label;
  return {
    apple: `https://maps.apple.com/?q=${encodeURIComponent(label)}&ll=${encodeURIComponent(coordinateQuery)}`,
    google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinateQuery || label)}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinateQuery || label)}`,
  };
}
