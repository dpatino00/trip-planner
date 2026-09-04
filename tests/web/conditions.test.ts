// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createConditionsHandler } from "@/lib/conditions/handler";
import { createMemoryRateLimiter } from "@/lib/trips/rate-limit";
import { makeConditionsV2, NOW } from "./fixtures";

function source(overrides: Record<string, unknown> = {}) {
  return {
    weather: vi.fn().mockResolvedValue({
      timeZone: "America/Los_Angeles",
      temperatureC: 22,
      apparentTemperatureC: 22,
      precipitationProbability: 5,
      windKph: 16,
      weatherCode: 1,
      uvIndex: 5,
      isDay: true,
      sunrise: "2026-09-15T06:32:00-07:00",
      sunset: "2026-09-15T18:50:00-07:00",
    }),
    airQuality: vi.fn().mockResolvedValue({ usAqi: 35 }),
    marine: vi.fn().mockResolvedValue({
      seaSurfaceTemperatureC: 20.5,
      waveHeightM: 0.76,
      wavePeriodSeconds: 11,
    }),
    ...overrides,
  };
}

function setup(sourceOverrides: Record<string, unknown> = {}) {
  const provider = source(sourceOverrides);
  const handler = createConditionsHandler({
    source: provider as never,
    rateLimiter: createMemoryRateLimiter(),
    clock: () => NOW,
  });
  return { handler, provider };
}

function request(
  options: {
    latitude?: string;
    longitude?: string;
    at?: string;
    marine?: boolean;
    ip?: string;
  } = {},
) {
  const url = new URL("https://trip.test/api/conditions");
  if (options.latitude !== undefined) {
    url.searchParams.set("latitude", options.latitude);
  }
  if (options.longitude !== undefined) {
    url.searchParams.set("longitude", options.longitude);
  }
  if (options.at) url.searchParams.set("at", options.at);
  if (options.marine !== undefined) {
    url.searchParams.set("marine", String(options.marine));
  }
  return new Request(url, {
    headers: { "x-forwarded-for": options.ip ?? "203.0.113.10" },
  });
}

const coordinates = { latitude: "32.7157", longitude: "-117.1611" };

// @spec COND-API-001, COND-API-002
describe("destination target selection", () => {
  it("uses the current hour in the provider-resolved time zone", async () => {
    const { handler } = setup();
    const response = await handler(request(coordinates));
    const data = await response.json();

    expect(data.requestedFor).toBe("2026-09-15T10:00:00-07:00");
    expect(data.timeZone).toBe("America/Los_Angeles");
  });

  it("uses local noon for a date-only target", async () => {
    const { handler } = setup();
    const response = await handler(
      request({ ...coordinates, at: "2026-09-17" }),
    );
    expect((await response.json()).requestedFor).toBe(
      "2026-09-17T12:00:00-07:00",
    );
  });
});

// @spec COND-API-003, COND-API-004, COND-API-007, COND-API-008
it("normalizes destination weather, AQI, optional marine data, and metadata", async () => {
  const { handler } = setup();
  const response = await handler(
    request({ ...coordinates, marine: true, at: "2026-09-15T11:00:00-07:00" }),
  );
  const data = await response.json();

  expect(data).toMatchObject({
    status: "live",
    source: "Open-Meteo",
    coordinates: { latitude: 32.7157, longitude: -117.1611 },
    timeZone: "America/Los_Angeles",
    airQualityIndex: { scale: "us-aqi", value: 35 },
  });
  expect(data.temperatureF).toBeCloseTo(71.6);
  expect(data.windMph).toBeCloseTo(9.94, 1);
  expect(data.marine.seaSurfaceTemperatureF).toBeCloseTo(68.9);
  expect(data.marine.waveHeightFt).toBeCloseTo(2.49, 1);
  expect(data.fetchedAt).toBeTruthy();
  expect(data.expiresAt).toBeTruthy();
});

// @spec COND-API-005
it("does not request marine data when the client disables it", async () => {
  const { handler, provider } = setup();
  await handler(request({ ...coordinates, marine: false }));
  expect(provider.marine).not.toHaveBeenCalled();
});

// @spec COND-API-006
it("returns unavailable without provider calls when coordinates are absent", async () => {
  const { handler, provider } = setup();
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe("unavailable");
  expect(provider.weather).not.toHaveBeenCalled();
});

// @spec COND-API-009
it("sets the public condition caching contract", async () => {
  const { handler } = setup();
  const response = await handler(request(coordinates));
  expect(response.headers.get("cache-control")).toContain("s-maxage=900");
  expect(response.headers.get("cache-control")).toContain(
    "stale-while-revalidate=3600",
  );
});

// @spec COND-API-010
it("returns degraded data when one requested source fails", async () => {
  const { handler } = setup({
    marine: vi.fn().mockRejectedValue(new Error("timeout")),
  });
  const response = await handler(request({ ...coordinates, marine: true }));
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.status).toBe("degraded");
  expect(data.marine.status).toBe("unavailable");
  expect(data.temperatureF).not.toBeNull();
});

// @spec COND-API-011
it("returns a 200 unavailable envelope when all requested sources fail", async () => {
  const failure = () => vi.fn().mockRejectedValue(new Error("timeout"));
  const { handler } = setup({
    weather: failure(),
    airQuality: failure(),
    marine: failure(),
  });
  const response = await handler(request({ ...coordinates, marine: true }));
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe("unavailable");
});

// @spec COND-API-012
it("returns forecast-out-of-range without provider calls", async () => {
  const { handler, provider } = setup();
  const response = await handler(request({ ...coordinates, at: "2027-01-01" }));
  expect(response.status).toBe(200);
  expect((await response.json()).reason).toBe("forecast-out-of-range");
  expect(provider.weather).not.toHaveBeenCalled();
});

// @spec COND-API-013
it("rejects malformed coordinates or targets without provider calls", async () => {
  const { handler, provider } = setup();
  expect(
    (await handler(request({ latitude: "999", longitude: "0" }))).status,
  ).toBe(400);
  expect(
    (await handler(request({ ...coordinates, at: "not-a-date" }))).status,
  ).toBe(400);
  expect(provider.weather).not.toHaveBeenCalled();
});

// @spec COND-API-014
it("limits condition requests per hashed IP", async () => {
  const { handler } = setup();
  for (let index = 0; index < 120; index += 1) {
    expect(
      (await handler(request({ ...coordinates, ip: "198.51.100.12" }))).status,
    ).toBe(200);
  }
  expect(
    (await handler(request({ ...coordinates, ip: "198.51.100.12" }))).status,
  ).toBe(429);
});

it("provides a fixture matching the approved public shape", () => {
  expect(makeConditionsV2()).toMatchObject({
    source: "Open-Meteo",
    status: "live",
  });
});
