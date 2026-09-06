import { z } from "zod";

import type {
  Coordinates,
  CostLevel,
  Daypart,
  Interest,
  PlaceProfile,
  SavedPlace,
} from "@/lib/types";

const coordinatesSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
const httpsUrlSchema = z.string().url().startsWith("https://");
const validTag = /^[a-z0-9][a-z0-9 -]{0,29}$/;

export interface SuggestedPlaceCandidate {
  name: string;
  summary?: string;
  locality?: string | null;
  coordinates?: unknown;
  interests?: Interest[];
  tags?: string[];
  profile?: PlaceProfile;
  waterContact?: boolean;
  preferredDayparts?: Daypart[];
  durationMinutes?: number | null;
  costLevel?: CostLevel | null;
  accessibility?: SavedPlace["accessibility"];
  reservationRecommended?: boolean | null;
  sourceUrl?: unknown;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function cleanText(value: string | null | undefined) {
  const cleaned = (value ?? "").trim().replace(/\s+/g, " ");
  return cleaned || null;
}

// @spec PLC-DATA-006, PLC-DATA-008, PLC-BE-001, PLC-BE-002, PLC-BE-003, PLC-BE-004, CHAT-BE-004, CHAT-BE-005
export function createSuggestedPlace(
  candidate: SuggestedPlaceCandidate,
  currentPlaces: SavedPlace[],
  options: { clock: () => Date; idFactory: () => string },
) {
  const name = cleanText(candidate.name) ?? "";
  const locality = cleanText(candidate.locality);
  const duplicate =
    currentPlaces.find(
      (place) =>
        normalize(place.name) === normalize(name) &&
        normalize(place.locality) === normalize(locality),
    ) ?? null;
  if (duplicate) {
    return {
      place: duplicate,
      duplicate,
      warnings: ["Duplicate place matched by name and locality."],
    };
  }

  const warnings: string[] = [];
  const rawCoordinates = candidate.coordinates;
  const parsedCoordinates = coordinatesSchema.safeParse(rawCoordinates);
  const coordinates: Coordinates | null =
    rawCoordinates === undefined || rawCoordinates === null
      ? null
      : parsedCoordinates.success
        ? parsedCoordinates.data
        : null;
  if (
    rawCoordinates !== undefined &&
    rawCoordinates !== null &&
    !parsedCoordinates.success
  ) {
    warnings.push("Discarded invalid coordinates.");
  }

  const rawUrl = candidate.sourceUrl;
  const sourceUrl =
    typeof rawUrl === "string" && httpsUrlSchema.safeParse(rawUrl).success
      ? rawUrl
      : null;
  if (rawUrl !== undefined && rawUrl !== null && sourceUrl === null) {
    warnings.push("Discarded invalid sourceUrl.");
  }

  const tags = [
    ...new Set(
      (candidate.tags ?? [])
        .map((tag) => normalize(tag))
        .filter((tag) => validTag.test(tag)),
    ),
  ].slice(0, 10);
  const now = options.clock().toISOString();
  const place: SavedPlace = {
    id: `place-${options.idFactory()}`,
    name,
    summary: candidate.summary ?? "",
    locality,
    coordinates,
    interests: [...new Set(candidate.interests ?? [])],
    tags,
    profile: candidate.profile ?? "mixed",
    waterContact: candidate.waterContact ?? false,
    preferredDayparts: [...new Set(candidate.preferredDayparts ?? [])],
    durationMinutes: candidate.durationMinutes ?? null,
    costLevel: candidate.costLevel ?? null,
    accessibility: candidate.accessibility ?? [],
    reservationRecommended: candidate.reservationRecommended ?? null,
    sourceUrl,
    origin: "chatgpt",
    createdAt: now,
    updatedAt: now,
  };
  return { place, duplicate: null, warnings };
}
