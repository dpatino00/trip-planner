import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type {
  PlanProposal,
  SavedPlace,
  TripDocument,
  TripMutation,
  TripPreferences,
} from "@/lib/types";
import { applyTripMutation } from "@/lib/trips/model";
import { migrateTripDocument } from "@/lib/trips/migrate";
import { buildPlanProposal } from "@/lib/trips/optimizer";
import type { RateLimiter } from "@/lib/trips/rate-limit";
import type { StoredTrip, TripRepository } from "@/lib/trips/repository-memory";
import { destinationSchema, tripPreferencesSchema } from "@/lib/trips/schema";
import {
  hashPrivateKey,
  isValidShareToken,
  tripKeyForToken,
} from "@/lib/trips/token";

const noStore = { "cache-control": "no-store" };
const common = {
  version: z.number().int().positive(),
  mutationId: z.uuid(),
};
const coordinates = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
const interests = z.array(
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
);
const dayparts = z.array(
  z.enum(["morning", "midday", "afternoon", "golden-hour", "evening"]),
);
const access = z.array(
  z.enum(["low-walking", "step-free", "accessible-parking"]),
);
const cost = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const placeInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    summary: z.string().max(500).optional(),
    locality: z.string().trim().min(1).max(120).nullable().optional(),
    coordinates: z.unknown().optional(),
    interests: interests.optional(),
    tags: z.array(z.string()).optional(),
    profile: z.enum(["indoor", "outdoor", "coastal", "mixed"]).optional(),
    waterContact: z.boolean().optional(),
    preferredDayparts: dayparts.optional(),
    durationMinutes: z.number().int().min(15).max(1440).nullable().optional(),
    costLevel: cost.nullable().optional(),
    accessibility: access.optional(),
    reservationRecommended: z.boolean().nullable().optional(),
    sourceUrl: z.unknown().optional(),
  })
  .strict();
const editablePlaceFields = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    summary: z.string().max(500).optional(),
    locality: z.string().trim().min(1).max(120).nullable().optional(),
    coordinates: coordinates.nullable().optional(),
    interests: interests.optional(),
    tags: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9 -]{0,29}$/))
      .max(10)
      .optional(),
    profile: z.enum(["indoor", "outdoor", "coastal", "mixed"]).optional(),
    waterContact: z.boolean().optional(),
    preferredDayparts: dayparts.optional(),
    durationMinutes: z.number().int().min(15).max(1440).nullable().optional(),
    costLevel: cost.nullable().optional(),
    accessibility: access.optional(),
    reservationRecommended: z.boolean().nullable().optional(),
    sourceUrl: z.string().url().startsWith("https://").nullable().optional(),
  })
  .strict();

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}
function error(code: string, message: string, status: number) {
  return response(
    { error: { code, message, retryable: status === 409 || status >= 429 } },
    status,
  );
}
function sameSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
async function readBody(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 64 * 1024) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
function normalize(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function currentProposal(trip: TripDocument) {
  return (
    trip.proposals.find((proposal) => proposal.status === "pending") ?? null
  );
}
function actionResult<T>(
  message: string,
  trip: TripDocument,
  data: T,
  warnings: string[] = [],
) {
  return response({
    message,
    tripVersion: trip.version,
    data,
    proposal: currentProposal(trip),
    warnings,
  });
}

interface Dependencies {
  repository: TripRepository;
  rateLimiter: RateLimiter;
  actionKey: string;
  clock?: () => Date;
}

// @spec ACT-API-001, ACT-API-002, ACT-API-003, ACT-API-004, ACT-API-013, ACT-API-014, ACT-API-016, ACT-API-017
export function createActionHandlers({
  repository,
  rateLimiter,
  actionKey,
  clock = () => new Date(),
}: Dependencies) {
  if (Buffer.byteLength(actionKey) < 32) {
    throw new Error("Action key must contain at least 32 bytes");
  }

  async function authenticate(
    request: Request,
    mutation: boolean,
  ): Promise<{ failure: Response } | { key: string }> {
    const actionMatch = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/);
    if (!actionMatch || !sameSecret(actionMatch[1], actionKey)) {
      return {
        failure: error("action-auth-invalid", "Invalid Action key", 401),
      };
    }
    const token = request.headers.get("x-trip-token");
    if (!token || !isValidShareToken(token)) {
      return {
        failure: error(
          "trip-auth-invalid",
          "A valid trip token is required",
          401,
        ),
      };
    }
    const rateKey = hashPrivateKey(`${actionKey}:${token}`);
    try {
      const allowed = await rateLimiter.check(
        `action-${mutation ? "write" : "read"}:${rateKey}`,
        mutation ? 30 : 60,
        60_000,
        clock().getTime(),
      );
      if (!allowed) {
        return {
          failure: error("rate-limited", "Too many Action requests", 429),
        };
      }
    } catch {
      return {
        failure: error(
          "storage-unavailable",
          "Trip storage is unavailable",
          503,
        ),
      };
    }
    return { key: tripKeyForToken(token) };
  }

  async function load(
    request: Request,
    mutation: boolean,
  ): Promise<
    | { failure: Response }
    | { key: string; stored: StoredTrip; trip: TripDocument }
  > {
    const auth = await authenticate(request, mutation);
    if ("failure" in auth) return auth;
    try {
      const stored = await repository.get(auth.key);
      if (!stored) {
        return { failure: error("trip-not-found", "Trip not found", 404) };
      }
      return {
        key: auth.key,
        stored,
        trip: migrateTripDocument(stored.trip),
      };
    } catch {
      return {
        failure: error(
          "storage-unavailable",
          "Trip storage is unavailable",
          503,
        ),
      };
    }
  }

  async function mutate<T>(
    request: Request,
    schema: z.ZodType<T>,
    makeMutation: (input: T, trip: TripDocument) => TripMutation,
    makeData: (trip: TripDocument, input: T) => unknown,
    message: string,
    options: { optimize?: boolean; warnings?: string[] } = {},
  ) {
    const raw = await readBody(request);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return error("invalid-action-input", "Action input is invalid", 400);
    }
    const loaded = await load(request, true);
    if ("failure" in loaded) return loaded.failure;
    const input = parsed.data as T & { version: number; mutationId: string };
    if (loaded.stored.recentMutationIds.includes(input.mutationId)) {
      return actionResult(
        message,
        loaded.trip,
        makeData(loaded.trip, parsed.data),
        options.warnings,
      );
    }
    if (loaded.trip.version !== input.version) {
      return response(
        {
          error: {
            code: "version-conflict",
            message: "Trip changed elsewhere",
            retryable: true,
          },
          tripVersion: loaded.trip.version,
        },
        409,
      );
    }
    let changed: TripDocument;
    try {
      changed = applyTripMutation(
        loaded.trip,
        makeMutation(parsed.data, loaded.trip),
      );
      if (options.optimize) {
        const proposal = buildPlanProposal(changed, {
          conditions: null,
          now: clock(),
        });
        if (proposal) {
          changed = applyTripMutation(changed, {
            type: "store-plan-proposal",
            proposal: { ...proposal, baseVersion: loaded.trip.version + 1 },
          });
        }
      }
      changed = {
        ...changed,
        version: loaded.trip.version + 1,
        updatedAt: clock().toISOString(),
      };
    } catch (cause) {
      return error(
        "invalid-action-input",
        cause instanceof Error ? cause.message : "Action input is invalid",
        400,
      );
    }
    const updated = await repository.update(
      loaded.key,
      loaded.stored.trip.version,
      {
        trip: changed,
        recentMutationIds: [
          ...loaded.stored.recentMutationIds,
          input.mutationId,
        ].slice(-50),
      },
    );
    if (!updated.ok) {
      return response(
        {
          error: {
            code: "version-conflict",
            message: "Trip changed elsewhere",
            retryable: true,
          },
          tripVersion: updated.latest?.trip.version ?? loaded.trip.version,
        },
        409,
      );
    }
    return actionResult(
      message,
      changed,
      makeData(changed, parsed.data),
      options.warnings,
    );
  }

  return {
    // @spec ACT-API-005
    async getTripContext(request: Request) {
      const loaded = await load(request, false);
      if ("failure" in loaded) return loaded.failure;
      const trip = loaded.trip;
      return actionResult("Current trip context", trip, {
        title: trip.title,
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        homeBase: trip.homeBase,
        preferences: trip.preferences,
        places: trip.places,
        itinerary: trip.itinerary,
        latestProposal: currentProposal(trip),
        version: trip.version,
      });
    },

    // @spec ACT-API-006, ACT-BE-003
    setTripDestination(request: Request) {
      const schema = z
        .object({ ...common, destination: destinationSchema })
        .strict();
      return mutate(
        request,
        schema,
        (input) => ({
          type: "set-destination",
          destination: input.destination,
        }),
        (trip) => ({ destination: trip.destination }),
        "Destination updated",
        { optimize: true },
      );
    },

    // @spec ACT-API-007, PLC-BE-001, PLC-BE-002, PLC-BE-003, PLC-BE-004
    async addPlace(request: Request) {
      const raw = await readBody(request);
      const schema = z.object({ ...common, place: placeInput }).strict();
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return error("invalid-action-input", "Action input is invalid", 400);
      }
      const loaded = await load(request, true);
      if ("failure" in loaded) return loaded.failure;
      if (loaded.stored.recentMutationIds.includes(parsed.data.mutationId)) {
        const repeated = loaded.trip.places.find(
          (place) =>
            normalize(place.name) === normalize(parsed.data.place.name) &&
            normalize(place.locality) === normalize(parsed.data.place.locality),
        );
        return actionResult("Place already saved", loaded.trip, {
          place: repeated,
        });
      }
      if (loaded.trip.version !== parsed.data.version) {
        return response(
          {
            error: {
              code: "version-conflict",
              message: "Trip changed elsewhere",
              retryable: true,
            },
            tripVersion: loaded.trip.version,
          },
          409,
        );
      }
      const existing = loaded.trip.places.find(
        (place) =>
          normalize(place.name) === normalize(parsed.data.place.name) &&
          normalize(place.locality) === normalize(parsed.data.place.locality),
      );
      if (existing) {
        return actionResult(
          "Place already saved",
          loaded.trip,
          { place: existing },
          ["Duplicate place matched by name and locality."],
        );
      }
      const warnings: string[] = [];
      const rawCoordinates = parsed.data.place.coordinates;
      const parsedCoordinates = coordinates.safeParse(rawCoordinates);
      const safeCoordinates =
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
      const rawUrl = parsed.data.place.sourceUrl;
      const safeUrl =
        typeof rawUrl === "string" &&
        z.string().url().startsWith("https://").safeParse(rawUrl).success
          ? rawUrl
          : null;
      if (rawUrl !== undefined && rawUrl !== null && safeUrl === null) {
        warnings.push("Discarded invalid sourceUrl.");
      }
      const now = clock().toISOString();
      const tags = [
        ...new Set(
          (parsed.data.place.tags ?? [])
            .map((tag) => tag.trim().toLocaleLowerCase())
            .filter((tag) => /^[a-z0-9][a-z0-9 -]{0,29}$/.test(tag)),
        ),
      ].slice(0, 10);
      const place: SavedPlace = {
        id: `place-${crypto.randomUUID()}`,
        name: parsed.data.place.name.trim(),
        summary: parsed.data.place.summary ?? "",
        locality: parsed.data.place.locality ?? null,
        coordinates: safeCoordinates,
        interests: parsed.data.place.interests ?? [],
        tags,
        profile: parsed.data.place.profile ?? "mixed",
        waterContact: parsed.data.place.waterContact ?? false,
        preferredDayparts: parsed.data.place.preferredDayparts ?? [],
        durationMinutes: parsed.data.place.durationMinutes ?? null,
        costLevel: parsed.data.place.costLevel ?? null,
        accessibility: parsed.data.place.accessibility ?? [],
        reservationRecommended:
          parsed.data.place.reservationRecommended ?? null,
        sourceUrl: safeUrl,
        origin: "chatgpt",
        createdAt: now,
        updatedAt: now,
      };
      const regenerated = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(parsed.data),
      });
      return mutate(
        regenerated,
        schema,
        () => ({ type: "add-place", place }),
        (trip) => ({
          place: trip.places.find((candidate) => candidate.id === place.id)!,
        }),
        "Place saved",
        { optimize: true, warnings },
      );
    },

    // @spec ACT-API-008, ACT-BE-003
    updatePlace(request: Request, { placeId }: { placeId: string }) {
      const schema = z
        .object({ ...common, changes: editablePlaceFields })
        .strict();
      return mutate(
        request,
        schema,
        (input) => ({
          type: "update-place",
          placeId,
          changes: input.changes,
        }),
        (trip) => ({
          place: trip.places.find((place) => place.id === placeId),
        }),
        "Place updated",
        { optimize: true },
      );
    },

    // @spec ACT-API-009, ACT-BE-003
    setTripPreferences(request: Request) {
      const schema = z
        .object({ ...common, preferences: tripPreferencesSchema })
        .strict();
      return mutate(
        request,
        schema,
        (input) => ({
          type: "set-preferences",
          preferences: input.preferences as TripPreferences,
        }),
        (trip) => ({ preferences: trip.preferences }),
        "Preferences updated",
        { optimize: true },
      );
    },

    // @spec ACT-API-010, OPT-BE-006, OPT-BE-007
    optimizeTrip(request: Request) {
      const schema = z.object(common).strict();
      return mutate(
        request,
        schema,
        (_input, trip) => {
          const proposal = buildPlanProposal(trip, {
            conditions: null,
            now: clock(),
          });
          if (!proposal) throw new Error("No useful plan changes were found");
          return {
            type: "store-plan-proposal",
            proposal: { ...proposal, baseVersion: trip.version + 1 },
          };
        },
        (trip) => ({ proposal: currentProposal(trip) }),
        "Plan proposal ready for review",
      ).then(async (result) => {
        if (!result.ok) return result;
        const value = await result.json();
        return response({ ...value, proposal: value.data.proposal });
      });
    },

    // @spec ACT-API-011, OPT-BE-008, OPT-BE-009
    applyPlanProposal(
      request: Request,
      { proposalId }: { proposalId: string },
    ) {
      const schema = z.object(common).strict();
      return mutate(
        request,
        schema,
        () => ({ type: "apply-plan-proposal", proposalId }),
        (trip) => ({
          proposal: trip.proposals.find(
            (proposal) => proposal.id === proposalId,
          ) as PlanProposal | undefined,
        }),
        "Plan proposal applied",
      );
    },
  };
}
