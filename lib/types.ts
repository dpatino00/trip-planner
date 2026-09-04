export type DestinationId = "san-diego";
export type ConditionZoneId = "coast" | "urban" | "inland";
export type Daypart =
  "morning" | "midday" | "afternoon" | "golden-hour" | "evening";
export type CostLevel = 0 | 1 | 2 | 3;
export type PlaceProfile = "indoor" | "outdoor" | "coastal" | "mixed";
export type Interest =
  | "coast"
  | "outdoors"
  | "food"
  | "culture"
  | "history"
  | "wildlife"
  | "nightlife"
  | "shopping"
  | "relaxing";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Schema-v1 catalog shape, retained only for seed data and migration. */
export interface Place {
  id: string;
  destinationId: DestinationId;
  name: string;
  tagline: string;
  description: string;
  neighborhoodId: string;
  conditionZone: ConditionZoneId;
  coordinates: Coordinates;
  interests: Interest[];
  profile: PlaceProfile;
  waterContact: boolean;
  preferredDayparts: Daypart[];
  durationMinutes: number;
  costLevel: CostLevel;
  accessibility: Array<"low-walking" | "step-free" | "accessible-parking">;
  reservationRecommended: boolean;
  sourceUrl: string;
  directions: { applePlaceId?: string; googleQuery: string };
  image: { src: string; alt: string; credit: string; licenseUrl: string };
  lastVerifiedAt: string;
}

export interface TripDestination {
  name: string;
  locality: string | null;
  countryCode: string | null;
  coordinates: Coordinates | null;
  timeZone: string | null;
}

export interface SavedPlace {
  id: string;
  name: string;
  summary: string;
  locality: string | null;
  coordinates: Coordinates | null;
  interests: Interest[];
  tags: string[];
  profile: PlaceProfile;
  waterContact: boolean;
  preferredDayparts: Daypart[];
  durationMinutes: number | null;
  costLevel: CostLevel | null;
  accessibility: Array<"low-walking" | "step-free" | "accessible-parking">;
  reservationRecommended: boolean | null;
  sourceUrl: string | null;
  origin: "seed" | "chatgpt" | "manual";
  createdAt: string;
  updatedAt: string;
  unavailable?: boolean;
}

export interface TripPreferences {
  interests: Interest[];
  maximumCost: CostLevel;
  pace: "relaxed" | "balanced" | "full";
  mobility: "standard" | "low-walking" | "step-free";
  notes: string;
}

export interface ItineraryItem {
  id: string;
  placeId: string;
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
  order: number;
  notes: string;
  status: "tentative" | "confirmed";
}

export type ProposalChange =
  | {
      type: "add-item";
      placeId: string;
      date: string;
      startTime: string | null;
      rationale: string;
    }
  | {
      type: "move-tentative-item";
      itemId: string;
      date: string;
      startTime: string | null;
      rationale: string;
    }
  | {
      type: "reorder-tentative-items";
      date: string;
      orderedItemIds: string[];
      rationale: string;
    };

export interface PlanProposal {
  id: string;
  baseVersion: number;
  status: "pending" | "applied" | "dismissed" | "superseded";
  summary: string;
  changes: ProposalChange[];
  createdAt: string;
}

export interface TripDocument {
  schemaVersion: 2;
  version: number;
  title: string;
  destination: TripDestination;
  startDate: string;
  endDate: string;
  homeBase: { label: string; coordinates: Coordinates | null } | null;
  preferences: TripPreferences;
  places: SavedPlace[];
  favoritePlaceIds: string[];
  itinerary: ItineraryItem[];
  proposals: PlanProposal[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface LegacyPlaceItineraryItem {
  id: string;
  kind: "place";
  placeId: string;
  date: string;
  startTime: string | null;
  order: number;
  notes: string;
}
export interface LegacyCustomItineraryItem {
  id: string;
  kind: "custom";
  title: string;
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
  order: number;
  notes: string;
  externalUrl: string | null;
}
export interface LegacyTripDocument {
  schemaVersion: 1;
  version: number;
  destinationId: DestinationId;
  title: string;
  startDate: string;
  endDate: string;
  homeBaseNeighborhoodId: string | null;
  preferences: Omit<TripPreferences, "notes">;
  favoritePlaceIds: string[];
  itinerary: Array<LegacyPlaceItineraryItem | LegacyCustomItineraryItem>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type NewItineraryItem = Omit<ItineraryItem, "id" | "order">;
export type TripMutation =
  | {
      type: "update-details";
      title: string;
      startDate: string;
      endDate: string;
      destination: TripDestination;
      homeBase: TripDocument["homeBase"];
    }
  | { type: "set-destination"; destination: TripDestination }
  | { type: "set-preferences"; preferences: TripPreferences }
  | { type: "add-place"; place: SavedPlace }
  | {
      type: "update-place";
      placeId: string;
      changes: Partial<
        Pick<
          SavedPlace,
          | "name"
          | "summary"
          | "locality"
          | "coordinates"
          | "interests"
          | "tags"
          | "profile"
          | "waterContact"
          | "preferredDayparts"
          | "durationMinutes"
          | "costLevel"
          | "accessibility"
          | "reservationRecommended"
          | "sourceUrl"
        >
      >;
    }
  | { type: "add-favorite" | "remove-favorite"; placeId: string }
  | { type: "add-itinerary-item"; item: NewItineraryItem }
  | {
      type: "update-itinerary-item";
      itemId: string;
      changes: Partial<Omit<ItineraryItem, "id" | "placeId">>;
    }
  | { type: "remove-itinerary-item"; itemId: string }
  | { type: "reorder-itinerary-day"; date: string; orderedItemIds: string[] }
  | { type: "store-plan-proposal"; proposal: PlanProposal }
  | { type: "apply-plan-proposal"; proposalId: string }
  | { type: "dismiss-plan-proposal"; proposalId: string };

export interface TripMutationRequest {
  baseVersion: number;
  mutationId: string;
  mutation: TripMutation;
}

export type DataFreshness = "live" | "stale" | "unavailable";
export interface ConditionValues {
  status: DataFreshness;
  temperatureF: number | null;
  apparentTemperatureF: number | null;
  precipitationProbability: number | null;
  windMph: number | null;
  weatherCode: number | null;
  uvIndex: number | null;
  usAqi: number | null;
  isDay: boolean | null;
  sunrise: string | null;
  sunset: string | null;
}
export interface ZoneConditions extends ConditionValues {
  zoneId: ConditionZoneId;
}
export interface MarineConditions {
  status: DataFreshness;
  seaSurfaceTemperatureF: number | null;
  waveHeightFt: number | null;
  wavePeriodSeconds: number | null;
  disclaimer: string;
}
export interface ConditionsEnvelope {
  status: "live" | "degraded" | "unavailable";
  requestedFor: string;
  fetchedAt: string;
  expiresAt: string;
  coordinates: Coordinates | null;
  timeZone: string | null;
  temperatureF: number | null;
  apparentTemperatureF: number | null;
  precipitationProbability: number | null;
  windMph: number | null;
  weatherCode: number | null;
  uvIndex: number | null;
  airQualityIndex: { scale: "us-aqi"; value: number } | null;
  isDay: boolean | null;
  sunrise: string | null;
  sunset: string | null;
  marine: MarineConditions | null;
  source: "Open-Meteo";
  reason?: string;
}
export interface Recommendation {
  placeId: string;
  score: number;
  reasons: string[];
  cautions: string[];
  distanceMiles: number | null;
  conditionsStatus: DataFreshness;
}
