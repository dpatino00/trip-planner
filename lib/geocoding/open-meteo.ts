import type { Coordinates, TripDestination } from "@/lib/types";

export interface GeocodingResult {
  name: string;
  locality: string | null;
  countryCode: string | null;
  coordinates: Coordinates;
  timeZone: string | null;
}

interface OpenMeteoResult {
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  country_code?: unknown;
  admin1?: unknown;
  timezone?: unknown;
}

function isResult(value: OpenMeteoResult): value is OpenMeteoResult & {
  name: string;
  latitude: number;
  longitude: number;
} {
  return (
    typeof value.name === "string" &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude)
  );
}

export async function geocodeDestination(
  name: string,
  signal?: AbortSignal,
): Promise<GeocodingResult[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: name.trim(),
    count: "5",
    language: "en",
    format: "json",
  }).toString();
  const response = await fetch(url, { signal, cache: "force-cache" });
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
  const data = (await response.json()) as { results?: OpenMeteoResult[] };
  return (data.results ?? []).filter(isResult).map((result) => ({
    name: result.name,
    locality: typeof result.admin1 === "string" ? result.admin1 : null,
    countryCode:
      typeof result.country_code === "string" ? result.country_code : null,
    coordinates: {
      latitude: result.latitude,
      longitude: result.longitude,
    },
    timeZone: typeof result.timezone === "string" ? result.timezone : null,
  }));
}

export function destinationFromGeocoding(
  destination: TripDestination,
  result: GeocodingResult,
): TripDestination {
  return {
    ...destination,
    name: destination.name,
    locality: result.locality,
    countryCode: result.countryCode,
    coordinates: result.coordinates,
    timeZone: result.timeZone,
  };
}
