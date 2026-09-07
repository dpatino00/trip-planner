import { buildTripChatContext } from "@/lib/chat/context";
import type { TripChatModel, TripChatUsage } from "@/lib/chat/model";
import { TripChatInvalidOutputError } from "@/lib/chat/model";
import {
  tripChatCandidateResponseSchema,
  tripChatRequestSchema,
  tripChatResponseSchema,
} from "@/lib/chat/schema";
import { migrateTripDocument } from "@/lib/trips/migrate";
import type { RateLimiter } from "@/lib/trips/rate-limit";
import type { StoredTrip, TripRepository } from "@/lib/trips/repository-memory";
import type { TripDocument } from "@/lib/types";
import {
  hashPrivateKey,
  isValidShareToken,
  tripKeyForToken,
} from "@/lib/trips/token";

const noStore = { "cache-control": "no-store" };

interface ChatLogEvent {
  event: "trip_chat";
  requestId: string;
  model: string;
  tripHash: string;
  durationMs: number;
  status: number;
  upstreamStatus?: number;
  upstreamCode?: string;
  usage?: TripChatUsage;
}

interface Dependencies {
  repository: TripRepository;
  rateLimiter: RateLimiter;
  model: TripChatModel | null;
  modelName: string;
  timeoutMs?: number;
  clock?: () => Date;
  logger?: (event: ChatLogEvent) => void;
}

class ChatTimeoutError extends Error {}

function result(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

function error(
  code: string,
  message: string,
  status: number,
  retryable = false,
) {
  return result({ error: { code, message, retryable } }, status);
}

function tokenFrom(request: Request) {
  const match = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match && isValidShareToken(match[1]) ? match[1] : null;
}

function clientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

function suppliedHttpsUrls(values: string[]) {
  const urls = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(/https:\/\/[^\s<>()"']+/g))
      urls.add(match[0]);
  }
  return urls;
}

function safeModelNameForLog(modelName: string) {
  return modelName.startsWith("sk-") ? "invalid-model-config" : modelName;
}

interface SavedPlaceSourceCandidate {
  savedPlaceId: string;
  sourceUrl: string;
}

// @spec CHAT-BE-002, CHAT-BE-016, CHAT-BE-017, CHAT-BE-018, CHAT-BE-019
async function enrichSavedPlaceSources(options: {
  repository: TripRepository;
  key: string;
  stored: StoredTrip;
  candidates: SavedPlaceSourceCandidate[];
  clock: () => Date;
}): Promise<TripDocument> {
  let currentStored = options.stored;
  let current = migrateTripDocument(currentStored.trip);
  const sources = new Map(
    options.candidates.map((candidate) => [
      candidate.savedPlaceId,
      candidate.sourceUrl,
    ]),
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timestamp = options.clock().toISOString();
    let changedCount = 0;
    const places = current.places.map((place) => {
      const sourceUrl = sources.get(place.id);
      if (!sourceUrl || place.sourceUrl !== null) return place;
      changedCount += 1;
      return { ...place, sourceUrl, updatedAt: timestamp };
    });
    if (changedCount === 0) return current;

    const changed: TripDocument = {
      ...current,
      places,
      version: current.version + 1,
      updatedAt: timestamp,
    };
    const updated = await options.repository.update(
      options.key,
      current.version,
      {
        trip: changed,
        recentMutationIds: currentStored.recentMutationIds,
      },
    );
    if (updated.ok)
      return updated.latest
        ? migrateTripDocument(updated.latest.trip)
        : changed;
    if (!updated.latest) return current;
    currentStored = updated.latest;
    current = migrateTripDocument(currentStored.trip);
  }

  return current;
}

async function readBody(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 16 * 1024)
    return { oversized: true as const };
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { invalid: true as const };
  }
}

async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ChatTimeoutError("Model request timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// @spec CHAT-API-001, CHAT-API-002, CHAT-API-003, CHAT-API-004, CHAT-API-005, CHAT-API-006, CHAT-API-007, CHAT-API-008, CHAT-API-009, CHAT-API-010, CHAT-API-011, CHAT-API-012, CHAT-BE-002, CHAT-BE-008, CHAT-BE-011, CHAT-BE-013, CHAT-BE-015
export function createTripChatHandler({
  repository,
  rateLimiter,
  model,
  modelName,
  timeoutMs = 20_000,
  clock = () => new Date(),
  logger = (event) => console.info(event),
}: Dependencies) {
  return async function POST(request: Request) {
    const currentContract = request.headers.get("x-trip-chat-contract") === "2";
    const token = tokenFrom(request);
    if (!token)
      return error("unauthorized", "A valid bearer token is required", 401);

    const tripHash = hashPrivateKey(token);
    const addressHash = hashPrivateKey(clientAddress(request));
    const now = clock();
    const day = now.toISOString().slice(0, 10);
    const untilMidnight =
      Date.parse(`${day}T00:00:00Z`) + 86_400_000 - now.getTime();
    try {
      const [pairAllowed, dayAllowed] = await Promise.all([
        rateLimiter.check(
          `chat-pair:${hashPrivateKey(`${tripHash}:${addressHash}`)}`,
          10,
          10 * 60_000,
          now.getTime(),
        ),
        rateLimiter.check(
          `chat-day:${tripHash}:${day}`,
          100,
          untilMidnight,
          now.getTime(),
        ),
      ]);
      if (!pairAllowed || !dayAllowed) {
        return error("rate-limited", "Ask allowance exhausted", 429, true);
      }
    } catch {
      return error(
        "storage-unavailable",
        "Trip storage is unavailable",
        503,
        true,
      );
    }

    const raw = await readBody(request);
    if ("oversized" in raw)
      return error("body-too-large", "Request body exceeds 16 KiB", 413);
    if (!("value" in raw))
      return error("invalid-json", "Invalid JSON body", 400);
    const parsed = tripChatRequestSchema.safeParse(raw.value);
    if (!parsed.success)
      return error("invalid-chat-input", "Ask input is invalid", 400);
    const submitted = [
      parsed.data.message,
      ...parsed.data.history.map((item) => item.content),
    ];
    if (submitted.some((content) => content.includes(token))) {
      return error(
        "credential-in-content",
        "Remove the private trip link from Ask",
        400,
      );
    }

    let stored;
    try {
      stored = await repository.get(tripKeyForToken(token));
    } catch {
      return error(
        "storage-unavailable",
        "Trip storage is unavailable",
        503,
        true,
      );
    }
    if (!stored) return error("trip-not-found", "Trip not found", 404);
    if (!model || !modelName) {
      return error(
        "configuration-unavailable",
        "Ask is not configured",
        503,
        true,
      );
    }

    const requestId = crypto.randomUUID();
    const started = Date.now();
    let status = 200;
    let upstreamStatus: number | undefined;
    let upstreamCode: string | undefined;
    let usage: TripChatUsage | undefined;
    try {
      const tripKey = tripKeyForToken(token);
      const trip = migrateTripDocument(stored.trip);
      const context = buildTripChatContext(trip);
      const generated = await withTimeout(
        (signal) =>
          model.generate({
            message: parsed.data.message,
            history: parsed.data.history,
            context,
            signal,
          }),
        timeoutMs,
      );
      usage = generated.usage;
      const output = tripChatCandidateResponseSchema.safeParse(
        generated.output,
      );
      if (!output.success)
        throw new TripChatInvalidOutputError("Invalid model output");
      const boundedIds = new Set(context.places.map((place) => place.id));
      const authoritativeIds = new Set(trip.places.map((place) => place.id));
      const savedPlaceIds = output.data.savedPlaceIds.filter(
        (id, index, ids) =>
          ids.indexOf(id) === index &&
          boundedIds.has(id) &&
          authoritativeIds.has(id),
      );
      const searchedUrls = suppliedHttpsUrls(generated.sources ?? []);
      const savedIdSet = new Set(savedPlaceIds);
      const sourceCandidates = output.data.savedPlaceSources.filter(
        (candidate) => {
          if (!savedIdSet.has(candidate.savedPlaceId)) return false;
          const place = trip.places.find(
            (item) => item.id === candidate.savedPlaceId,
          );
          return (
            place?.sourceUrl === null && searchedUrls.has(candidate.sourceUrl)
          );
        },
      );
      const responseTrip = sourceCandidates.length
        ? await enrichSavedPlaceSources({
            repository,
            key: tripKey,
            stored,
            candidates: sourceCandidates,
            clock,
          })
        : trip;
      const responsePlaceIds = new Set(
        responseTrip.places.map((place) => place.id),
      );
      const finalSavedPlaceIds = savedPlaceIds.filter((id) =>
        responsePlaceIds.has(id),
      );
      const response = tripChatResponseSchema.safeParse({
        message: output.data.message,
        savedPlaceIds: finalSavedPlaceIds,
        suggestions:
          finalSavedPlaceIds.length > 0
            ? []
            : output.data.suggestions.filter(
                (
                  suggestion,
                ): suggestion is typeof suggestion & { sourceUrl: string } =>
                  suggestion.sourceUrl !== null &&
                  searchedUrls.has(suggestion.sourceUrl),
              ),
        tripVersion: responseTrip.version,
      });
      if (!response.success)
        throw new TripChatInvalidOutputError("Invalid normalized model output");
      if (!currentContract) {
        const legacyResponse = {
          message: response.data.message,
          suggestions: response.data.suggestions,
        };
        return result(legacyResponse);
      }
      return result(response.data);
    } catch (cause) {
      if (cause && typeof cause === "object") {
        if ("status" in cause && typeof cause.status === "number")
          upstreamStatus = cause.status;
        if ("code" in cause && typeof cause.code === "string")
          upstreamCode = cause.code;
      }
      if (cause instanceof ChatTimeoutError) {
        status = 504;
        return error("model-timeout", "Ask took too long", 504, true);
      }
      if (cause instanceof TripChatInvalidOutputError) {
        status = 502;
        return error(
          "model-invalid-response",
          "Ask returned an invalid response",
          502,
          true,
        );
      }
      status = 503;
      return error(
        "model-unavailable",
        "Ask is temporarily unavailable",
        503,
        true,
      );
    } finally {
      logger({
        event: "trip_chat",
        requestId,
        model: safeModelNameForLog(modelName),
        tripHash,
        durationMs: Math.max(0, Date.now() - started),
        status,
        ...(upstreamStatus ? { upstreamStatus } : {}),
        ...(upstreamCode ? { upstreamCode } : {}),
        ...(usage ? { usage } : {}),
      });
    }
  };
}
