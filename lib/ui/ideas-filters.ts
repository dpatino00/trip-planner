import type { SavedPlace } from "@/lib/types";

export type IdeaFilters = {
  search: string;
  interest: string;
  cost: string;
  duration: string;
  profile: string;
  accessibility: string;
  reservation: boolean;
  favorites: boolean;
};

export const emptyIdeaFilters: IdeaFilters = {
  search: "",
  interest: "",
  cost: "",
  duration: "",
  profile: "",
  accessibility: "",
  reservation: false,
  favorites: false,
};

const filterKeys = [
  "search",
  "interest",
  "cost",
  "duration",
  "profile",
  "accessibility",
  "reservation",
  "favorites",
] as const;

export function readIdeaFilters(params: URLSearchParams): IdeaFilters {
  return {
    search: params.get("search") ?? "",
    interest: params.get("interest") ?? "",
    cost: params.get("cost") ?? "",
    duration: params.get("duration") ?? "",
    profile: params.get("profile") ?? "",
    accessibility: params.get("accessibility") ?? "",
    reservation: params.get("reservation") === "true",
    favorites: params.get("favorites") === "true",
  };
}

export function writeIdeaFilters(
  params: URLSearchParams,
  filters: IdeaFilters,
) {
  for (const key of filterKeys) {
    const value = filters[key];
    if (value === "" || value === false) params.delete(key);
    else params.set(key, String(value));
  }
  return params;
}

export function activeIdeaFilterCount(filters: IdeaFilters) {
  return Object.values(filters).filter(
    (value) => value !== "" && value !== false,
  ).length;
}

export function filterIdeas(
  places: SavedPlace[],
  favoritePlaceIds: string[],
  filters: IdeaFilters,
) {
  const query = normalizeSearch(filters.search);
  return places.filter((place) => {
    const searchable = normalizeSearch(
      [place.name, place.locality, place.summary, ...place.tags].join(" "),
    );
    return (
      searchable.includes(query) &&
      (!filters.interest ||
        place.interests.includes(filters.interest as never)) &&
      (!filters.cost || String(place.costLevel) === filters.cost) &&
      matchesDuration(place.durationMinutes, filters.duration) &&
      (!filters.profile || place.profile === filters.profile) &&
      (!filters.accessibility ||
        place.accessibility.includes(filters.accessibility as never)) &&
      (!filters.reservation || place.reservationRecommended === true) &&
      (!filters.favorites || favoritePlaceIds.includes(place.id))
    );
  });
}

function matchesDuration(duration: number | null, filter: string) {
  if (!filter) return true;
  if (duration === null) return false;
  if (filter === "short") return duration < 90;
  if (filter === "medium") return duration >= 90 && duration <= 180;
  return filter === "long" && duration > 180;
}

function normalizeSearch(value: string) {
  return value.normalize().toLocaleLowerCase();
}
