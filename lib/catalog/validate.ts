import { z } from "zod";
import type { Place } from "@/lib/types";

const httpsUrl = z.string().url().startsWith("https://");
const placeSchema = z
  .object({
    id: z.string().min(1),
    destinationId: z.literal("san-diego"),
    name: z.string().min(1),
    tagline: z.string().min(1),
    description: z.string().min(1),
    neighborhoodId: z.string().min(1),
    conditionZone: z.enum(["coast", "urban", "inland"]),
    coordinates: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
    interests: z
      .array(
        z.enum([
          "coast",
          "outdoors",
          "food",
          "culture",
          "history",
          "wildlife",
          "nightlife",
          "shopping",
          "relaxing",
        ]),
      )
      .min(1),
    profile: z.enum(["indoor", "outdoor", "coastal", "mixed"]),
    waterContact: z.boolean(),
    preferredDayparts: z
      .array(
        z.enum(["morning", "midday", "afternoon", "golden-hour", "evening"]),
      )
      .min(1),
    durationMinutes: z.number().int().positive(),
    costLevel: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
    accessibility: z.array(
      z.enum(["low-walking", "step-free", "accessible-parking"]),
    ),
    reservationRecommended: z.boolean(),
    sourceUrl: httpsUrl,
    directions: z.object({
      applePlaceId: z.string().optional(),
      googleQuery: z.string().min(1),
    }),
    image: z.object({
      src: z.string().regex(/^\/images\/places\/.+\.(avif|webp)$/),
      alt: z.string().min(1),
      credit: z.string().min(1),
      licenseUrl: httpsUrl,
    }),
    lastVerifiedAt: z.iso.date(),
  })
  .strict();

// @spec CAT-PROC-001
export function validateCatalog(catalog: Place[] | unknown[]) {
  const parsed = z.array(placeSchema).safeParse(catalog);
  if (!parsed.success) return parsed;
  const ids = new Set(parsed.data.map((place) => place.id));
  const interests = new Set(parsed.data.flatMap((place) => place.interests));
  const required = [
    "coast",
    "outdoors",
    "food",
    "culture",
    "history",
    "wildlife",
    "nightlife",
    "relaxing",
  ];
  if (
    ids.size !== parsed.data.length ||
    required.some((interest) => !interests.has(interest as never))
  )
    return {
      success: false as const,
      error: new Error("Catalog IDs or categories are incomplete"),
    };
  return parsed;
}
