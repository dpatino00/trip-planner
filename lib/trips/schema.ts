import { z } from "zod";

import { suggestedPlaceSchema } from "@/lib/chat/schema";

const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const interest = z.enum([
  "coast",
  "outdoors",
  "food",
  "culture",
  "history",
  "wildlife",
  "nightlife",
  "shopping",
  "relaxing",
]);
const cost = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const profile = z.enum(["indoor", "outdoor", "coastal", "mixed"]);
const accessibility = z.enum([
  "low-walking",
  "step-free",
  "accessible-parking",
]);
const coordinates = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();
const httpsUrl = z.string().url().startsWith("https://").nullable();

export const destinationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    locality: nullableText(120),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase())
      .nullable(),
    coordinates: coordinates.nullable(),
    timeZone: nullableText(80),
  })
  .strict();

export const tripPreferencesSchema = z
  .object({
    interests: z.array(interest),
    maximumCost: cost,
    pace: z.enum(["relaxed", "balanced", "full"]),
    mobility: z.enum(["standard", "low-walking", "step-free"]),
    notes: z.string().max(1000),
  })
  .strict();

export const savedPlaceSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(120),
    summary: z.string().max(500),
    locality: nullableText(120),
    coordinates: coordinates.nullable(),
    interests: z.array(interest),
    tags: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9 -]{0,29}$/))
      .max(10)
      .refine((values) => new Set(values).size === values.length),
    profile,
    waterContact: z.boolean(),
    preferredDayparts: z.array(
      z.enum(["morning", "midday", "afternoon", "golden-hour", "evening"]),
    ),
    durationMinutes: z.number().int().min(15).max(1440).nullable(),
    costLevel: cost.nullable(),
    accessibility: z.array(accessibility),
    reservationRecommended: z.boolean().nullable(),
    sourceUrl: httpsUrl,
    origin: z.enum(["seed", "chatgpt", "manual"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    unavailable: z.boolean().optional(),
  })
  .strict();

const itineraryItem = z
  .object({
    id: z.string().min(1),
    placeId: z.string().min(1),
    date,
    startTime: time.nullable(),
    durationMinutes: z.number().int().min(15).max(1440).nullable(),
    order: z.number().int().nonnegative(),
    notes: z.string().max(500),
    status: z.enum(["tentative", "confirmed"]),
  })
  .strict();

const proposalChange = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("add-item"),
      placeId: z.string().min(1),
      date,
      startTime: time.nullable(),
      rationale: z.string().min(1).max(240),
    })
    .strict(),
  z
    .object({
      type: z.literal("move-tentative-item"),
      itemId: z.string().min(1),
      date,
      startTime: time.nullable(),
      rationale: z.string().min(1).max(240),
    })
    .strict(),
  z
    .object({
      type: z.literal("reorder-tentative-items"),
      date,
      orderedItemIds: z.array(z.string().min(1)),
      rationale: z.string().min(1).max(240),
    })
    .strict(),
]);

export const planProposalSchema = z
  .object({
    id: z.string().min(1),
    baseVersion: z.number().int().positive(),
    status: z.enum(["pending", "applied", "dismissed", "superseded"]),
    summary: z.string().min(1).max(240),
    changes: z.array(proposalChange).max(10),
    createdAt: z.iso.datetime(),
  })
  .strict();

function rangeIsValid(value: { startDate: string; endDate: string }) {
  const days =
    (Date.parse(`${value.endDate}T00:00:00Z`) -
      Date.parse(`${value.startDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  return days >= 1 && days <= 31;
}

// @spec TRIP-DATA-001, TRIP-DATA-002, TRIP-DATA-006, TRIP-DATA-010, TRIP-DATA-011, TRIP-DATA-012, TRIP-DATA-017, TRIP-DATA-018
export const tripDocumentSchema = z
  .object({
    schemaVersion: z.literal(2),
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(80),
    destination: destinationSchema,
    startDate: date,
    endDate: date,
    homeBase: z
      .object({
        label: z.string().trim().min(1).max(120),
        coordinates: coordinates.nullable(),
      })
      .strict()
      .nullable(),
    preferences: tripPreferencesSchema,
    places: z.array(savedPlaceSchema),
    favoritePlaceIds: z.array(z.string().min(1)),
    itinerary: z.array(itineraryItem),
    proposals: z.array(planProposalSchema).max(3),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!rangeIsValid(value)) {
      context.addIssue({
        code: "custom",
        message: "Trip date range must span 1–31 days",
      });
    }
    const placeIds = new Set(value.places.map((place) => place.id));
    for (const placeId of value.favoritePlaceIds) {
      if (!placeIds.has(placeId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown place ${placeId}`,
        });
      }
    }
    for (const item of value.itinerary) {
      if (item.date < value.startDate || item.date > value.endDate) {
        context.addIssue({
          code: "custom",
          message: `Itinerary date ${item.date} is outside the trip`,
        });
      }
      if (!placeIds.has(item.placeId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown place ${item.placeId}`,
        });
      }
    }
  });

export const createTripInputSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    startDate: date,
    endDate: date,
    destination: destinationSchema,
    homeBase: z
      .object({
        label: z.string().trim().min(1).max(120),
        coordinates: coordinates.nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    preferences: tripPreferencesSchema.optional(),
  })
  .strict()
  .refine(rangeIsValid, "Trip date range must span 1–31 days");

const newItineraryItem = itineraryItem.omit({ id: true, order: true });
const placeChanges = savedPlaceSchema
  .omit({
    id: true,
    origin: true,
    createdAt: true,
    updatedAt: true,
    unavailable: true,
  })
  .partial()
  .strict();
const mutation = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("update-details"),
      title: z.string().trim().min(1).max(80),
      startDate: date,
      endDate: date,
      destination: destinationSchema,
      homeBase: z
        .object({
          label: z.string().trim().min(1).max(120),
          coordinates: coordinates.nullable(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("set-destination"),
      destination: destinationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("set-preferences"),
      preferences: tripPreferencesSchema,
    })
    .strict(),
  z.object({ type: z.literal("add-place"), place: savedPlaceSchema }).strict(),
  z
    .object({
      type: z.literal("add-suggested-place"),
      suggestion: suggestedPlaceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("add-suggested-places"),
      suggestions: z.array(suggestedPlaceSchema).min(1).max(12),
    })
    .strict(),
  z
    .object({
      type: z.literal("update-place"),
      placeId: z.string().min(1),
      changes: placeChanges,
    })
    .strict(),
  z
    .object({ type: z.literal("remove-place"), placeId: z.string().min(1) })
    .strict(),
  z
    .object({ type: z.literal("add-favorite"), placeId: z.string().min(1) })
    .strict(),
  z
    .object({ type: z.literal("remove-favorite"), placeId: z.string().min(1) })
    .strict(),
  z
    .object({ type: z.literal("add-itinerary-item"), item: newItineraryItem })
    .strict(),
  z
    .object({
      type: z.literal("update-itinerary-item"),
      itemId: z.string().min(1),
      changes: itineraryItem
        .omit({ id: true, placeId: true })
        .partial()
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("remove-itinerary-item"),
      itemId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("reorder-itinerary-day"),
      date,
      orderedItemIds: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      type: z.literal("store-plan-proposal"),
      proposal: planProposalSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("apply-plan-proposal"),
      proposalId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("dismiss-plan-proposal"),
      proposalId: z.string().min(1),
    })
    .strict(),
]);

// @spec TRIP-API-007, TRIP-DATA-007, CHAT-BE-025
export const tripMutationRequestSchema = z
  .object({
    baseVersion: z.number().int().positive(),
    mutationId: z.uuid(),
    mutation,
  })
  .strict();
