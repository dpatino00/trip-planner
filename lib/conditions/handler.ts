import type {
  ConditionsEnvelope,
  Coordinates,
  MarineConditions,
} from "@/lib/types";
import type { RateLimiter } from "@/lib/trips/rate-limit";
import { hashPrivateKey } from "@/lib/trips/token";

interface Weather {
  timeZone: string;
  temperatureC: number;
  apparentTemperatureC: number;
  precipitationProbability: number;
  windKph: number;
  weatherCode: number;
  uvIndex: number;
  isDay: boolean;
  sunrise: string;
  sunset: string;
}
interface ConditionSource {
  weather: (
    coordinates: Coordinates,
    at: string,
    signal?: AbortSignal,
  ) => Promise<Weather>;
  airQuality: (
    coordinates: Coordinates,
    at: string,
    signal?: AbortSignal,
  ) => Promise<{ usAqi: number }>;
  marine: (
    coordinates: Coordinates,
    at: string,
    signal?: AbortSignal,
  ) => Promise<{
    seaSurfaceTemperatureC: number;
    waveHeightM: number;
    wavePeriodSeconds: number;
  }>;
}
interface Dependencies {
  source: ConditionSource;
  rateLimiter: RateLimiter;
  clock?: () => Date;
}

const cacheHeaders = {
  "cache-control": "public, s-maxage=900, stale-while-revalidate=3600",
};
const noStore = { "cache-control": "no-store" };

function zoneOffset(date: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")
    ?.value.replace("GMT", "");
  return name === "" || name === undefined ? "+00:00" : name;
}

function localHour(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:00:00${zoneOffset(date, timeZone)}`;
}

function requestedTime(raw: string | null, now: Date, timeZone: string) {
  if (!raw) return localHour(now, timeZone);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const offset = zoneOffset(new Date(`${raw}T12:00:00Z`), timeZone);
    return `${raw}T12:00:00${offset}`;
  }
  return raw;
}

function parseCoordinates(url: URL): Coordinates | null | "invalid" {
  const rawLatitude = url.searchParams.get("latitude");
  const rawLongitude = url.searchParams.get("longitude");
  if (rawLatitude === null && rawLongitude === null) return null;
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  if (
    rawLatitude === null ||
    rawLongitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return "invalid";
  }
  return { latitude, longitude };
}

function validTarget(raw: string | null) {
  if (!raw) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return !Number.isNaN(Date.parse(`${raw}T12:00:00Z`));
  }
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(raw) &&
    !Number.isNaN(Date.parse(raw))
  );
}

function unavailable(
  requestedFor: string,
  now: Date,
  coordinates: Coordinates | null,
  timeZone: string | null,
  marineRequested: boolean,
  reason?: string,
): ConditionsEnvelope {
  return {
    status: "unavailable",
    requestedFor,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 900_000).toISOString(),
    coordinates,
    timeZone,
    temperatureF: null,
    apparentTemperatureF: null,
    precipitationProbability: null,
    windMph: null,
    weatherCode: null,
    uvIndex: null,
    airQualityIndex: null,
    isDay: null,
    sunrise: null,
    sunset: null,
    marine: marineRequested
      ? {
          status: "unavailable",
          seaSurfaceTemperatureF: null,
          waveHeightFt: null,
          wavePeriodSeconds: null,
          disclaimer: "Advisory model data; not suitable for navigation.",
        }
      : null,
    source: "Open-Meteo",
    reason,
  };
}

function apiError(code: string, message: string, status: number) {
  return Response.json(
    { error: { code, message, retryable: status >= 429 } },
    { status, headers: noStore },
  );
}

// @spec COND-API-001, COND-API-002, COND-API-003, COND-API-004, COND-API-005, COND-API-006, COND-API-007, COND-API-008, COND-API-009, COND-API-010, COND-API-011, COND-API-012, COND-API-013, COND-API-014
export function createConditionsHandler({
  source,
  rateLimiter,
  clock = () => new Date(),
}: Dependencies) {
  return async function handler(request: Request) {
    const now = clock();
    const url = new URL(request.url);
    const coordinates = parseCoordinates(url);
    const rawTarget = url.searchParams.get("at");
    const marineRequested = url.searchParams.get("marine") === "true";
    if (coordinates === "invalid" || !validTarget(rawTarget)) {
      return apiError(
        "invalid-target",
        "Coordinates or conditions target are malformed",
        400,
      );
    }
    if (!coordinates) {
      return Response.json(
        unavailable(now.toISOString(), now, null, null, marineRequested),
        { headers: cacheHeaders },
      );
    }
    const targetDate = rawTarget
      ? new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(rawTarget)
            ? `${rawTarget}T12:00:00Z`
            : rawTarget,
        )
      : now;
    if (Math.abs(targetDate.getTime() - now.getTime()) > 16 * 86_400_000) {
      return Response.json(
        unavailable(
          rawTarget ?? now.toISOString(),
          now,
          coordinates,
          null,
          marineRequested,
          "forecast-out-of-range",
        ),
        { headers: cacheHeaders },
      );
    }

    const address =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    try {
      const allowed = await rateLimiter.check(
        `conditions:${hashPrivateKey(address)}`,
        120,
        60_000,
        now.getTime(),
      );
      if (!allowed) return apiError("rate-limited", "Too many requests", 429);
    } catch {
      return apiError(
        "storage-unavailable",
        "Rate-limit storage is unavailable",
        503,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const providerTarget = rawTarget ?? now.toISOString();
    const calls: Array<Promise<unknown>> = [
      source.weather(coordinates, providerTarget, controller.signal),
      source.airQuality(coordinates, providerTarget, controller.signal),
    ];
    if (marineRequested) {
      calls.push(source.marine(coordinates, providerTarget, controller.signal));
    }
    const results = await Promise.allSettled(calls);
    clearTimeout(timer);

    const weatherResult = results[0] as PromiseSettledResult<Weather>;
    const airResult = results[1] as PromiseSettledResult<{ usAqi: number }>;
    const marineResult = results[2] as
      | PromiseSettledResult<{
          seaSurfaceTemperatureC: number;
          waveHeightM: number;
          wavePeriodSeconds: number;
        }>
      | undefined;
    const weather =
      weatherResult.status === "fulfilled" ? weatherResult.value : null;
    const timeZone = weather?.timeZone ?? null;
    const requestedFor = requestedTime(rawTarget, now, timeZone ?? "UTC");
    if (results.every((result) => result.status === "rejected")) {
      return Response.json(
        unavailable(requestedFor, now, coordinates, timeZone, marineRequested),
        { headers: cacheHeaders },
      );
    }

    let marine: MarineConditions | null = null;
    if (marineRequested) {
      marine =
        marineResult?.status === "fulfilled"
          ? {
              status: "live",
              seaSurfaceTemperatureF:
                (marineResult.value.seaSurfaceTemperatureC * 9) / 5 + 32,
              waveHeightFt: marineResult.value.waveHeightM * 3.28084,
              wavePeriodSeconds: marineResult.value.wavePeriodSeconds,
              disclaimer: "Advisory model data; not suitable for navigation.",
            }
          : unavailable(requestedFor, now, coordinates, timeZone, true).marine;
    }
    const envelope: ConditionsEnvelope = {
      status: results.every((result) => result.status === "fulfilled")
        ? "live"
        : "degraded",
      requestedFor,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 900_000).toISOString(),
      coordinates,
      timeZone,
      temperatureF: weather ? (weather.temperatureC * 9) / 5 + 32 : null,
      apparentTemperatureF: weather
        ? (weather.apparentTemperatureC * 9) / 5 + 32
        : null,
      precipitationProbability: weather?.precipitationProbability ?? null,
      windMph: weather ? weather.windKph * 0.621371 : null,
      weatherCode: weather?.weatherCode ?? null,
      uvIndex: weather?.uvIndex ?? null,
      airQualityIndex:
        airResult.status === "fulfilled"
          ? { scale: "us-aqi", value: airResult.value.usAqi }
          : null,
      isDay: weather?.isDay ?? null,
      sunrise: weather?.sunrise ?? null,
      sunset: weather?.sunset ?? null,
      marine,
      source: "Open-Meteo",
    };
    return Response.json(envelope, { headers: cacheHeaders });
  };
}
