import type { TripDocument, TripMutationRequest } from "@/lib/types";
import { createSuggestedPlace } from "@/lib/places/suggested";
import { applyTripMutation, createTripDocument } from "@/lib/trips/model";
import { migrateTripDocument } from "@/lib/trips/migrate";
import type { RateLimiter } from "@/lib/trips/rate-limit";
import type { TripRepository } from "@/lib/trips/repository-memory";
import {
  createTripInputSchema,
  tripMutationRequestSchema,
} from "@/lib/trips/schema";
import {
  generateShareToken,
  hashPrivateKey,
  isValidShareToken,
  tripKeyForToken,
} from "@/lib/trips/token";

const noStore = { "cache-control": "no-store" };
function result(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}
function error(
  code: string,
  message: string,
  status: number,
  retryable = false,
) {
  return result({ error: { code, message, retryable } }, status);
}
function clientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}
function tokenFrom(request: Request) {
  const match = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match && isValidShareToken(match[1]) ? match[1] : null;
}
async function body(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 64 * 1024)
    return { oversized: true as const };
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { invalid: true as const };
  }
}

interface Dependencies {
  repository: TripRepository;
  rateLimiter: RateLimiter;
  clock?: () => Date;
  tokenFactory?: () => string;
  idFactory?: () => string;
}

// @spec TRIP-API-001, TRIP-API-002, TRIP-API-003, TRIP-API-004, TRIP-API-005, TRIP-API-006, TRIP-API-007, TRIP-API-008, TRIP-API-009, TRIP-API-010, TRIP-API-011, TRIP-API-012, TRIP-BE-003, TRIP-BE-004, TRIP-BE-005, SEC-API-003
export function createTripHandlers({
  repository,
  rateLimiter,
  clock = () => new Date(),
  tokenFactory = generateShareToken,
  idFactory = () => crypto.randomUUID(),
}: Dependencies) {
  async function authenticate(request: Request) {
    const token = tokenFrom(request);
    if (!token) return null;
    return {
      token,
      key: tripKeyForToken(token),
      address: hashPrivateKey(clientAddress(request)),
    };
  }

  async function enforceRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    message: string,
  ) {
    try {
      return (await rateLimiter.check(key, limit, windowMs, clock().getTime()))
        ? null
        : error("rate-limited", message, 429, true);
    } catch {
      return error(
        "storage-unavailable",
        "Trip storage is unavailable",
        503,
        true,
      );
    }
  }

  return {
    async POST(request: Request) {
      const address = hashPrivateKey(clientAddress(request));
      const limitResponse = await enforceRateLimit(
        `trip-create:${address}`,
        10,
        3_600_000,
        "Too many trip creations",
      );
      if (limitResponse) return limitResponse;
      const parsedBody = await body(request);
      if ("oversized" in parsedBody)
        return error("body-too-large", "Request body exceeds 64 KiB", 413);
      if (!("value" in parsedBody))
        return error("invalid-json", "Invalid JSON body", 400);
      const input = createTripInputSchema.safeParse(parsedBody.value);
      if (!input.success)
        return error("invalid-trip", "Trip details are invalid", 400);
      try {
        const trip = createTripDocument(input.data, clock());
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const token = tokenFactory();
          if (!isValidShareToken(token)) continue;
          if (
            await repository.create(tripKeyForToken(token), {
              trip,
              recentMutationIds: [],
            })
          )
            return result({ token, trip }, 201);
        }
        return error("token-collision", "Could not create trip", 503, true);
      } catch {
        return error(
          "storage-unavailable",
          "Trip storage is unavailable",
          503,
          true,
        );
      }
    },

    async GET(request: Request) {
      const auth = await authenticate(request);
      if (!auth)
        return error("unauthorized", "A valid bearer token is required", 401);
      const limitResponse = await enforceRateLimit(
        `trip-read:${hashPrivateKey(`${auth.token}:${auth.address}`)}`,
        120,
        60_000,
        "Too many trip reads",
      );
      if (limitResponse) return limitResponse;
      try {
        const stored = await repository.get(auth.key);
        return stored
          ? result({ trip: migrateTripDocument(stored.trip) })
          : error("trip-not-found", "Trip not found", 404);
      } catch {
        return error(
          "storage-unavailable",
          "Trip storage is unavailable",
          503,
          true,
        );
      }
    },

    async PATCH(request: Request) {
      const auth = await authenticate(request);
      if (!auth)
        return error("unauthorized", "A valid bearer token is required", 401);
      const limitResponse = await enforceRateLimit(
        `trip-write:${hashPrivateKey(`${auth.token}:${auth.address}`)}`,
        60,
        60_000,
        "Too many trip changes",
      );
      if (limitResponse) return limitResponse;
      const parsedBody = await body(request);
      if ("oversized" in parsedBody)
        return error("body-too-large", "Request body exceeds 64 KiB", 413);
      if (!("value" in parsedBody))
        return error("invalid-json", "Invalid JSON body", 400);
      const parsed = tripMutationRequestSchema.safeParse(parsedBody.value);
      if (!parsed.success)
        return error("invalid-mutation", "Trip change is invalid", 400);
      try {
        const stored = await repository.get(auth.key);
        if (!stored) return error("trip-not-found", "Trip not found", 404);
        const requestBody = parsed.data as TripMutationRequest;
        const current = migrateTripDocument(stored.trip);
        if (stored.recentMutationIds.includes(requestBody.mutationId))
          return result({ trip: current });
        if (stored.trip.version !== requestBody.baseVersion)
          return result(
            {
              error: {
                code: "version-conflict",
                message: "Trip changed elsewhere",
                retryable: true,
              },
              trip: current,
            },
            409,
          );
        let changed: TripDocument;
        try {
          if (requestBody.mutation.type === "add-suggested-place") {
            const created = createSuggestedPlace(
              requestBody.mutation.suggestion,
              current.places,
              { clock, idFactory },
            );
            if (created.duplicate) {
              return result({
                trip: current,
                duplicate: true,
                warnings: created.warnings,
              });
            }
            changed = applyTripMutation(current, {
              type: "add-place",
              place: created.place,
            });
          } else {
            changed = applyTripMutation(current, requestBody.mutation);
          }
        } catch (cause) {
          return error(
            "invalid-mutation",
            cause instanceof Error ? cause.message : "Trip change is invalid",
            400,
          );
        }
        changed = {
          ...changed,
          version: current.version + 1,
          updatedAt: clock().toISOString(),
        };
        const update = await repository.update(auth.key, stored.trip.version, {
          trip: changed,
          recentMutationIds: [
            ...stored.recentMutationIds,
            requestBody.mutationId,
          ].slice(-50),
        });
        if (!update.ok)
          return result(
            {
              error: {
                code: "version-conflict",
                message: "Trip changed elsewhere",
                retryable: true,
              },
              trip: update.latest
                ? migrateTripDocument(update.latest.trip)
                : current,
            },
            409,
          );
        return result({ trip: changed });
      } catch {
        return error(
          "storage-unavailable",
          "Trip storage is unavailable",
          503,
          true,
        );
      }
    },

    async DELETE(request: Request) {
      const auth = await authenticate(request);
      if (!auth)
        return error("unauthorized", "A valid bearer token is required", 401);
      const limitResponse = await enforceRateLimit(
        `trip-write:${hashPrivateKey(`${auth.token}:${auth.address}`)}`,
        60,
        60_000,
        "Too many trip changes",
      );
      if (limitResponse) return limitResponse;
      const parsedBody = await body(request);
      if (
        !("value" in parsedBody) ||
        JSON.stringify(parsedBody.value) !==
          JSON.stringify({ confirmation: "DELETE" })
      )
        return error("invalid-confirmation", "Type DELETE to confirm", 400);
      try {
        return (await repository.delete(auth.key))
          ? new Response(null, { status: 204, headers: noStore })
          : error("trip-not-found", "Trip not found", 404);
      } catch {
        return error(
          "storage-unavailable",
          "Trip storage is unavailable",
          503,
          true,
        );
      }
    },
  };
}
