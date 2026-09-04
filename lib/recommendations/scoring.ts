import type {
  ConditionsEnvelope,
  Coordinates,
  Daypart,
  MarineConditions,
  PlaceProfile,
  SavedPlace,
  TripDocument,
  TripPreferences,
  ZoneConditions,
} from "@/lib/types";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

type ScorablePlace = Pick<
  SavedPlace,
  | "interests"
  | "costLevel"
  | "durationMinutes"
  | "profile"
  | "waterContact"
  | "preferredDayparts"
>;

// @spec REC-BE-002
export function scorePreference(
  place: Pick<SavedPlace, "interests" | "costLevel" | "durationMinutes">,
  preferences: TripPreferences | Omit<TripPreferences, "notes">,
) {
  const matches = place.interests.filter((interest) =>
    preferences.interests.includes(interest),
  ).length;
  let score =
    preferences.interests.length === 0 ? 24 : Math.min(35, 12 + 12 * matches);
  if (place.costLevel !== null && place.costLevel > preferences.maximumCost) {
    score -= 8;
  }
  const targets = { relaxed: 180, balanced: 300, full: 480 };
  if (
    place.durationMinutes !== null &&
    place.durationMinutes > targets[preferences.pace]
  ) {
    score -= 5;
  }
  return clamp(score, 0, 35);
}

function precipitationPenalty(value: number | null) {
  return value === null || value <= 10
    ? 0
    : value <= 30
      ? 4
      : value <= 60
        ? 10
        : 18;
}
function temperaturePenalty(value: number | null) {
  if (value === null || (value >= 60 && value <= 82)) return 0;
  return Math.min(
    10,
    Math.ceil((value < 60 ? 60 - value : value - 82) / 5) * 2,
  );
}
function windPenalty(value: number | null) {
  return value === null || value <= 15 ? 0 : value <= 25 ? 4 : 10;
}
function airPenalty(value: number | null) {
  return value === null || value <= 50
    ? 0
    : value <= 100
      ? 2
      : value <= 150
        ? 7
        : 14;
}
function wavePenalty(value: number | null | undefined) {
  return value == null || value <= 4 ? 0 : value <= 6 ? 5 : 10;
}

type ScoringConditions = Pick<
  ZoneConditions,
  | "status"
  | "temperatureF"
  | "precipitationProbability"
  | "windMph"
  | "usAqi"
  | "isDay"
  | "sunset"
>;

function outdoorScore(
  place: Pick<ScorablePlace, "waterContact">,
  condition: ScoringConditions,
  marine: Partial<MarineConditions> | null,
) {
  const penalties = [
    [precipitationPenalty(condition.precipitationProbability), "rain-likely"],
    [temperaturePenalty(condition.temperatureF), "temperature-mismatch"],
    [windPenalty(condition.windMph), "wind-exposed"],
    [airPenalty(condition.usAqi), "air-quality"],
    [
      place.waterContact ? wavePenalty(marine?.waveHeightFt) : 0,
      "rougher-water",
    ],
  ] as Array<[number, string]>;
  return {
    value: clamp(
      30 - penalties.reduce((sum, [value]) => sum + value, 0),
      0,
      30,
    ),
    cautions: penalties.filter(([value]) => value > 0).map(([, code]) => code),
  };
}

function indoorScore(condition: ScoringConditions) {
  const adverse = [
    condition.precipitationProbability !== null &&
      condition.precipitationProbability > 30,
    condition.temperatureF !== null &&
      (condition.temperatureF < 60 || condition.temperatureF > 82),
    condition.windMph !== null && condition.windMph > 15,
    condition.usAqi !== null && condition.usAqi > 100,
  ].filter(Boolean).length;
  return { value: Math.min(30, 24 + adverse * 2), cautions: [] as string[] };
}

// @spec REC-BE-003, REC-BE-013, REC-BE-014, REC-BE-015, REC-BE-016, REC-BE-017, REC-BE-018, REC-BE-019, REC-BE-022
export function scoreConditions(
  place: Pick<ScorablePlace, "profile" | "waterContact">,
  condition: ScoringConditions,
  marine: Partial<MarineConditions> | null,
) {
  if (!condition || condition.status === "unavailable") {
    return { value: 18, cautions: [] as string[] };
  }
  if (place.profile === "indoor") return indoorScore(condition);
  const outside = outdoorScore(place, condition, marine);
  if (place.profile !== "mixed") return outside;
  const inside = indoorScore(condition);
  return {
    value: Math.round((inside.value + outside.value) / 2),
    cautions: outside.cautions,
  };
}

// @spec REC-BE-020
export function classifyDaypart(value: string, sunset: string | null): Daypart {
  const target = new Date(value);
  if (sunset) {
    const sunsetTime = new Date(sunset);
    if (target > sunsetTime) return "evening";
    if (target.getTime() >= sunsetTime.getTime() - 90 * 60_000) {
      return "golden-hour";
    }
  }
  const hour = Number(value.match(/T(\d{2}):/)?.[1] ?? target.getHours());
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 16) return "afternoon";
  if (hour < 18) return "golden-hour";
  return "evening";
}

// @spec REC-BE-004, REC-BE-021
export function scoreTime(
  preferred: Daypart[],
  current: Daypart,
  isDay: boolean,
  profile: PlaceProfile,
) {
  if (!isDay && (profile === "outdoor" || profile === "coastal")) return 2;
  if (preferred.includes(current)) return 20;
  const order: Daypart[] = [
    "morning",
    "midday",
    "afternoon",
    "golden-hour",
    "evening",
  ];
  const currentIndex = order.indexOf(current);
  return preferred.some(
    (part) => Math.abs(order.indexOf(part) - currentIndex) === 1,
  )
    ? 12
    : 6;
}

// @spec REC-BE-005
export function haversineMiles(left: Coordinates, right: Coordinates) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(right.latitude - left.latitude);
  const longitude = radians(right.longitude - left.longitude);
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(left.latitude)) *
      Math.cos(radians(right.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function scoreDistance(distance: number | null) {
  return distance === null
    ? 8
    : distance <= 2
      ? 15
      : distance <= 5
        ? 12
        : distance <= 10
          ? 8
          : distance <= 20
            ? 4
            : 1;
}

function flatConditions(conditions: ConditionsEnvelope): ScoringConditions {
  return {
    status: conditions.status === "unavailable" ? "unavailable" : "live",
    temperatureF: conditions.temperatureF,
    precipitationProbability: conditions.precipitationProbability,
    windMph: conditions.windMph,
    usAqi: conditions.airQualityIndex?.value ?? null,
    isDay: conditions.isDay,
    sunset: conditions.sunset,
  };
}

// @spec REC-BE-001, REC-BE-006, REC-BE-007, REC-BE-010, REC-BE-011, REC-BE-012
export function scorePlace(
  place: SavedPlace,
  trip: TripDocument,
  conditions: ConditionsEnvelope,
  target: Date,
  origin: Coordinates | null,
) {
  const current = flatConditions(conditions);
  const preferenceScore = scorePreference(place, trip.preferences);
  const condition =
    conditions.status === "unavailable"
      ? { value: 18, cautions: [] as string[] }
      : scoreConditions(place, current, conditions.marine);
  const daypart = classifyDaypart(target.toISOString(), conditions.sunset);
  const timeScore = scoreTime(
    place.preferredDayparts,
    daypart,
    conditions.isDay ?? true,
    place.profile,
  );
  const distanceMiles =
    origin && place.coordinates
      ? haversineMiles(origin, place.coordinates)
      : null;
  const distanceScore = scoreDistance(distanceMiles);
  const contributions = [
    [preferenceScore, "preference-match"],
    [condition.value, "conditions-fit"],
    [timeScore, "time-fit"],
    [distanceScore, "distance-fit"],
  ] as Array<[number, string]>;
  const reasons = contributions
    .filter(
      ([score, code]) =>
        score > 0 &&
        !(code === "conditions-fit" && conditions.status === "unavailable"),
    )
    .sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))
    .slice(0, 3)
    .map(([, code]) => code);
  const cautions = [...condition.cautions];
  if (
    place.costLevel !== null &&
    place.costLevel > trip.preferences.maximumCost
  ) {
    cautions.push("over-budget");
  }
  if (
    place.durationMinutes !== null &&
    place.durationMinutes >
      { relaxed: 180, balanced: 300, full: 480 }[trip.preferences.pace]
  ) {
    cautions.push("long-duration");
  }
  if (timeScore === 2) cautions.push("after-daylight");
  return {
    placeId: place.id,
    score: clamp(
      preferenceScore + condition.value + timeScore + distanceScore,
      0,
      100,
    ),
    reasons,
    cautions,
    distanceMiles,
    conditionsStatus: current.status,
    preferenceScore,
    conditionsScore: condition.value,
    timeScore,
    distanceScore,
    safetyAssessment: undefined,
  };
}

// @spec REC-BE-008, REC-BE-009
export function rankPlaces(
  places: SavedPlace[],
  trip: TripDocument,
  conditions: ConditionsEnvelope,
  target: Date,
  origin: Coordinates | null,
) {
  const names = new Map(places.map((place) => [place.id, place.name]));
  return places
    .map((place) => scorePlace(place, trip, conditions, target, origin))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftName = names.get(left.placeId)!.normalize().toLocaleLowerCase();
      const rightName = names
        .get(right.placeId)!
        .normalize()
        .toLocaleLowerCase();
      return (
        leftName.localeCompare(rightName) ||
        left.placeId.localeCompare(right.placeId)
      );
    })
    .slice(0, 6);
}
