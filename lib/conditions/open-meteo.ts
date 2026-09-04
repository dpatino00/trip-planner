import type { Coordinates } from "@/lib/types";

async function json(url: URL, signal?: AbortSignal) {
  const response = await fetch(url, { signal, next: { revalidate: 900 } });
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
  return (await response.json()) as Record<string, any>;
}

function closest(values: string[], at: string) {
  const target = Date.parse(at);
  return values.reduce(
    (best, value, index) =>
      Math.abs(Date.parse(value) - target) <
      Math.abs(Date.parse(values[best]) - target)
        ? index
        : best,
    0,
  );
}

function baseParams(coordinates: Coordinates) {
  return {
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    timezone: "auto",
  };
}

// @spec COND-API-002, COND-API-003, COND-API-004
export const openMeteoSource = {
  async weather(coordinates: Coordinates, at: string, signal?: AbortSignal) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      ...baseParams(coordinates),
      hourly:
        "temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,weather_code,uv_index,is_day",
      daily: "sunrise,sunset",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
    }).toString();
    const data = await json(url, signal);
    const index = closest(data.hourly.time, at);
    return {
      timeZone: data.timezone,
      temperatureC: data.hourly.temperature_2m[index],
      apparentTemperatureC: data.hourly.apparent_temperature[index],
      precipitationProbability: data.hourly.precipitation_probability[index],
      windKph: data.hourly.wind_speed_10m[index],
      weatherCode: data.hourly.weather_code[index],
      uvIndex: data.hourly.uv_index[index],
      isDay: Boolean(data.hourly.is_day[index]),
      sunrise: data.daily.sunrise[0],
      sunset: data.daily.sunset[0],
    };
  },
  async airQuality(coordinates: Coordinates, at: string, signal?: AbortSignal) {
    const url = new URL(
      "https://air-quality-api.open-meteo.com/v1/air-quality",
    );
    url.search = new URLSearchParams({
      ...baseParams(coordinates),
      hourly: "us_aqi",
    }).toString();
    const data = await json(url, signal);
    return { usAqi: data.hourly.us_aqi[closest(data.hourly.time, at)] };
  },
  async marine(coordinates: Coordinates, at: string, signal?: AbortSignal) {
    const url = new URL("https://marine-api.open-meteo.com/v1/marine");
    url.search = new URLSearchParams({
      ...baseParams(coordinates),
      hourly: "sea_surface_temperature,wave_height,wave_period",
    }).toString();
    const data = await json(url, signal);
    const index = closest(data.hourly.time, at);
    return {
      seaSurfaceTemperatureC: data.hourly.sea_surface_temperature[index],
      waveHeightM: data.hourly.wave_height[index],
      wavePeriodSeconds: data.hourly.wave_period[index],
    };
  },
};
