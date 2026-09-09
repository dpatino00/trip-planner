import { z } from "zod";

const interestSchema = z.enum([
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
const daypartSchema = z.enum([
  "morning",
  "midday",
  "afternoon",
  "golden-hour",
  "evening",
]);

const placeIdSchema = z.string().trim().min(1).max(120);
export const scheduleItemSchema = z
  .object({
    savedPlaceId: placeIdSchema,
    date: z.iso.date(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    durationMinutes: z.number().int().min(15).max(1440),
  })
  .strict();
const savedPlaceIdsSchema = z.array(placeIdSchema).max(12);
const uniqueSavedPlaceIdsSchema = savedPlaceIdsSchema.refine(
  (values) => new Set(values).size === values.length,
);
const savedPlaceSourceCandidateSchema = z
  .object({
    savedPlaceId: z.string().trim().min(1).max(120),
    sourceUrl: z.string().url().startsWith("https://"),
  })
  .strict();
const savedPlaceSourcesSchema = z
  .array(savedPlaceSourceCandidateSchema)
  .max(12)
  .refine(
    (values) =>
      new Set(values.map((value) => value.savedPlaceId)).size === values.length,
  );

function hasOneOrTwoSentences(value: string) {
  const endings = value.match(/[.!?](?:\s|$)/g)?.length ?? 0;
  return endings >= 1 && endings <= 2;
}

// @spec CHAT-DATA-001, CHAT-DATA-002
export const suggestedPlaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(20).max(500).refine(hasOneOrTwoSentences),
    locality: z.string().trim().min(1).max(120).nullable(),
    interests: z
      .array(interestSchema)
      .refine((values) => new Set(values).size === values.length),
    tags: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9 -]{0,29}$/))
      .max(10)
      .refine((values) => new Set(values).size === values.length),
    profile: z.enum(["indoor", "outdoor", "coastal", "mixed"]),
    preferredDayparts: z
      .array(daypartSchema)
      .refine((values) => new Set(values).size === values.length),
    durationMinutes: z.number().int().min(15).max(1440).nullable(),
    costLevel: z
      .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
      .nullable(),
    reservationRecommended: z.boolean().nullable(),
    sourceUrl: z.string().url().startsWith("https://").nullable(),
  })
  .strict();

const sourcedSuggestedPlaceSchema = suggestedPlaceSchema.extend({
  sourceUrl: z.string().url().startsWith("https://"),
});

function normalizedValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function uniqueSuggestionKeys(
  values: Array<{ name: string; locality: string | null }>,
) {
  const keys = values.map(
    (value) =>
      `${normalizedValue(value.name)}|${normalizedValue(value.locality ?? "")}`,
  );
  return new Set(keys).size === keys.length;
}

const unresolvedPlaceNamesSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(12)
  .refine(
    (values) =>
      new Set(values.map((value) => normalizedValue(value))).size ===
      values.length,
  );

// @spec CHAT-DATA-002, CHAT-DATA-005, CHAT-DATA-007, CHAT-API-011
export const tripChatResponseSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    savedPlaceIds: uniqueSavedPlaceIdsSchema,
    suggestions: z
      .array(suggestedPlaceSchema)
      .max(12)
      .refine(uniqueSuggestionKeys),
    unresolvedPlaceNames: unresolvedPlaceNamesSchema,
    tripVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    const resultCount =
      value.savedPlaceIds.length +
      value.suggestions.length +
      value.unresolvedPlaceNames.length;
    if (resultCount > 12) {
      context.addIssue({
        code: "custom",
        message: "Ask response exceeds twelve combined results",
      });
    }
  });

// @spec CHAT-DATA-011, CHAT-API-014
export const tripChatResponseV4Schema = tripChatResponseSchema.extend({
  scheduledItem: scheduleItemSchema.nullable().default(null),
});

export const tripChatResponseV2Schema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    savedPlaceIds: z
      .array(placeIdSchema)
      .max(3)
      .refine((values) => new Set(values).size === values.length),
    suggestions: z.array(sourcedSuggestedPlaceSchema).max(3),
    tripVersion: z.number().int().positive(),
  })
  .strict();

// Model candidates permit duplicate IDs so the authoritative handler can
// silently normalize them before validating the public response contract.
// @spec CHAT-DATA-006
export const tripChatCandidateResponseSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    savedPlaceIds: savedPlaceIdsSchema,
    savedPlaceSources: savedPlaceSourcesSchema,
    suggestions: z.array(suggestedPlaceSchema).max(12),
    unresolvedPlaceNames: z
      .array(z.string().trim().min(1).max(120))
      .max(12)
      .default([]),
    scheduledItem: scheduleItemSchema.nullable().default(null),
  })
  .strict();

// The Responses API's strict JSON Schema accepts the basic required types, but
// not all of the local-only Zod refinements used by tripChatResponseSchema.
// Keep those checks for post-response validation in the handler.
const suggestedPlaceModelSchema = z
  .object({
    name: z.string(),
    summary: z.string(),
    locality: z.string().nullable(),
    interests: z.array(interestSchema),
    tags: z.array(z.string()),
    profile: z.enum(["indoor", "outdoor", "coastal", "mixed"]),
    preferredDayparts: z.array(daypartSchema),
    durationMinutes: z.number().nullable(),
    costLevel: z.number().nullable(),
    reservationRecommended: z.boolean().nullable(),
    sourceUrl: z.string().nullable(),
  })
  .strict();
const savedPlaceSourceModelSchema = z
  .object({
    savedPlaceId: z.string(),
    sourceUrl: z.string(),
  })
  .strict();

// @spec CHAT-DATA-006
export const tripChatModelResponseSchema = z
  .object({
    message: z.string(),
    savedPlaceIds: z.array(z.string()).max(12),
    savedPlaceSources: z.array(savedPlaceSourceModelSchema).max(12),
    suggestions: z.array(suggestedPlaceModelSchema).max(12),
    unresolvedPlaceNames: z.array(z.string()).max(12),
    scheduledItem: scheduleItemSchema.nullable(),
  })
  .strict();

const historyItemSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(2000),
  })
  .strict();

// @spec CHAT-API-001, CHAT-API-004, CHAT-API-013, CHAT-DATA-008
export const tripChatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(8000),
    history: z.array(historyItemSchema).max(8),
    createCards: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    const characters = value.history.reduce(
      (total, item) => total + item.content.length,
      0,
    );
    if (characters > 8000) {
      context.addIssue({
        code: "custom",
        path: ["history"],
        message: "History exceeds 8,000 characters",
      });
    }
  });

export const tripChatRequestV2Schema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    history: z.array(historyItemSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    const characters = value.history.reduce(
      (total, item) => total + item.content.length,
      0,
    );
    if (characters > 8000) {
      context.addIssue({
        code: "custom",
        path: ["history"],
        message: "History exceeds 8,000 characters",
      });
    }
  });

export type TripChatRequest = z.infer<typeof tripChatRequestSchema>;
export type TripChatResponse = z.infer<typeof tripChatResponseSchema>;
export type ScheduledItem = z.infer<typeof scheduleItemSchema>;
