export const SHARE_TOKEN = "A".repeat(22);
export const NOW = new Date("2026-09-15T17:00:00.000Z");

export function makePlace(overrides: Record<string, unknown> = {}): any {
  return {
    id: "balboa-park",
    destinationId: "san-diego",
    name: "Balboa Park",
    tagline: "Gardens, museums, and architecture",
    description: "A flexible cultural stop in central San Diego.",
    neighborhoodId: "balboa-park",
    conditionZone: "urban",
    coordinates: { latitude: 32.7341, longitude: -117.1446 },
    interests: ["culture", "outdoors"],
    profile: "mixed",
    waterContact: false,
    preferredDayparts: ["morning", "afternoon"],
    durationMinutes: 180,
    costLevel: 1,
    accessibility: ["low-walking", "step-free", "accessible-parking"],
    reservationRecommended: false,
    sourceUrl: "https://www.balboapark.org/",
    directions: { googleQuery: "Balboa Park San Diego" },
    image: {
      src: "/images/places/balboa-park.webp",
      alt: "Balboa Park architecture and gardens",
      credit: "Test photographer",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
    lastVerifiedAt: "2026-09-01",
    ...overrides,
  };
}

export function makeTrip(overrides: Record<string, unknown> = {}): any {
  return {
    schemaVersion: 1,
    version: 1,
    destinationId: "san-diego",
    title: "San Diego escape",
    startDate: "2026-09-14",
    endDate: "2026-09-18",
    homeBaseNeighborhoodId: "little-italy",
    preferences: {
      interests: ["coast", "outdoors", "food", "culture"],
      maximumCost: 2,
      pace: "balanced",
      mobility: "standard",
    },
    favoritePlaceIds: [],
    itinerary: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2027-03-17T06:59:59.999Z",
    ...overrides,
  };
}

export function makeSavedPlace(overrides: Record<string, unknown> = {}): any {
  return {
    id: "place-balboa-park",
    name: "Balboa Park",
    summary: "Gardens, museums, and architecture.",
    locality: "San Diego, CA",
    coordinates: { latitude: 32.7341, longitude: -117.1446 },
    interests: ["culture", "outdoors"],
    tags: ["gardens", "museum"],
    profile: "mixed",
    waterContact: false,
    preferredDayparts: ["morning", "afternoon"],
    durationMinutes: 180,
    costLevel: 1,
    accessibility: ["low-walking", "step-free", "accessible-parking"],
    reservationRecommended: false,
    sourceUrl: "https://www.balboapark.org/",
    origin: "chatgpt",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

export function makeTripV2(overrides: Record<string, unknown> = {}): any {
  const places = [
    makeSavedPlace(),
    makeSavedPlace({
      id: "place-torrey-pines",
      name: "Torrey Pines State Reserve",
      summary: "Coastal trails and overlooks.",
      locality: "La Jolla, CA",
      coordinates: { latitude: 32.921, longitude: -117.2533 },
      interests: ["coast", "outdoors"],
      tags: ["hiking", "views"],
      profile: "coastal",
      preferredDayparts: ["morning", "golden-hour"],
      sourceUrl: null,
    }),
    makeSavedPlace({
      id: "place-tacos",
      name: "Oscar's Mexican Seafood",
      summary: "Casual seafood tacos.",
      locality: "Pacific Beach, CA",
      coordinates: { latitude: 32.7971, longitude: -117.2553 },
      interests: ["food"],
      tags: ["tacos", "casual"],
      profile: "indoor",
      preferredDayparts: ["midday", "evening"],
      durationMinutes: 60,
      sourceUrl: "https://oscarsmexicanseafood.com/",
    }),
    makeSavedPlace({
      id: "place-cabrillo",
      name: "Cabrillo National Monument",
      locality: "Point Loma, CA",
      interests: ["history", "coast"],
      tags: ["history", "views"],
      profile: "coastal",
    }),
    makeSavedPlace({
      id: "place-mingei",
      name: "Mingei International Museum",
      interests: ["culture"],
      tags: ["museum"],
      profile: "indoor",
    }),
    makeSavedPlace({
      id: "place-sunset-cliffs",
      name: "Sunset Cliffs Natural Park",
      locality: "San Diego, CA",
      interests: ["coast", "relaxing"],
      tags: ["sunset", "views"],
      profile: "coastal",
      preferredDayparts: ["golden-hour"],
      sourceUrl: null,
    }),
  ];
  return {
    schemaVersion: 2,
    version: 1,
    title: "San Diego escape",
    destination: {
      name: "San Diego",
      locality: "California",
      countryCode: "US",
      coordinates: { latitude: 32.7157, longitude: -117.1611 },
      timeZone: "America/Los_Angeles",
    },
    startDate: "2026-09-14",
    endDate: "2026-09-18",
    homeBase: {
      label: "Little Italy",
      coordinates: { latitude: 32.7226, longitude: -117.1684 },
    },
    preferences: {
      interests: ["outdoors", "food", "culture", "relaxing"],
      maximumCost: 2,
      pace: "balanced",
      mobility: "standard",
      notes: "Keep afternoons flexible.",
    },
    places,
    favoritePlaceIds: [],
    itinerary: [],
    proposals: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2027-03-17T06:59:59.999Z",
    ...overrides,
  };
}

export function makeZone(overrides: Record<string, unknown> = {}): any {
  return {
    zoneId: "urban",
    status: "live",
    temperatureF: 72,
    apparentTemperatureF: 72,
    precipitationProbability: 5,
    windMph: 8,
    weatherCode: 1,
    uvIndex: 5,
    usAqi: 35,
    isDay: true,
    sunrise: "2026-09-15T06:32:00-07:00",
    sunset: "2026-09-15T18:50:00-07:00",
    ...overrides,
  };
}

export function makeConditions(overrides: Record<string, unknown> = {}): any {
  const zone = makeZone();
  return {
    status: "live",
    requestedFor: "2026-09-15T10:00:00-07:00",
    fetchedAt: "2026-09-15T16:59:00.000Z",
    expiresAt: "2026-09-15T17:14:00.000Z",
    zones: {
      coast: { ...zone, zoneId: "coast" },
      urban: zone,
      inland: { ...zone, zoneId: "inland", temperatureF: 78 },
    },
    marine: {
      status: "live",
      seaSurfaceTemperatureF: 69,
      waveHeightFt: 2.5,
      wavePeriodSeconds: 11,
      disclaimer: "Advisory model data; not suitable for navigation.",
    },
    source: "Open-Meteo",
    ...overrides,
  };
}

export function makeConditionsV2(overrides: Record<string, unknown> = {}): any {
  return {
    status: "live",
    requestedFor: "2026-09-15T10:00:00-07:00",
    fetchedAt: "2026-09-15T16:59:00.000Z",
    expiresAt: "2026-09-15T17:14:00.000Z",
    coordinates: { latitude: 32.7157, longitude: -117.1611 },
    timeZone: "America/Los_Angeles",
    temperatureF: 72,
    apparentTemperatureF: 72,
    precipitationProbability: 5,
    windMph: 8,
    weatherCode: 1,
    uvIndex: 5,
    airQualityIndex: { scale: "us-aqi", value: 35 },
    isDay: true,
    sunrise: "2026-09-15T06:32:00-07:00",
    sunset: "2026-09-15T18:50:00-07:00",
    marine: {
      status: "live",
      seaSurfaceTemperatureF: 69,
      waveHeightFt: 2.5,
      wavePeriodSeconds: 11,
      disclaimer: "Advisory model data; not suitable for navigation.",
    },
    source: "Open-Meteo",
    ...overrides,
  };
}
