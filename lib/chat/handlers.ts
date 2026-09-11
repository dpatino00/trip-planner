import { buildTripChatContext } from "@/lib/chat/context";
import {
  hasExplicitAdditionIntent,
  hasExplicitLinkEnrichmentIntent,
  hasScheduleIntent,
  hasExplicitSavedPlaceLookupIntent,
  normalizedPlaceKey,
} from "@/lib/chat/intent";
import type { TripChatModel, TripChatUsage } from "@/lib/chat/model";
import { TripChatInvalidOutputError } from "@/lib/chat/model";
import {
  tripChatCandidateResponseSchema,
  tripChatRequestSchema,
  tripChatRequestV2Schema,
  tripChatResponseSchema,
  tripChatResponseV4Schema,
  tripChatResponseV5Schema,
  tripChatResponseV2Schema,
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

async function readBody(request: Request, maximumBytes: number) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maximumBytes)
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

// @spec CHAT-DATA-002, CHAT-DATA-005, CHAT-DATA-007, CHAT-DATA-013, CHAT-API-001, CHAT-API-002, CHAT-API-003, CHAT-API-004, CHAT-API-005, CHAT-API-006, CHAT-API-007, CHAT-API-008, CHAT-API-009, CHAT-API-010, CHAT-API-011, CHAT-API-012, CHAT-API-013, CHAT-API-015, CHAT-BE-002, CHAT-BE-009, CHAT-BE-010, CHAT-BE-011, CHAT-BE-012, CHAT-BE-013, CHAT-BE-015, CHAT-BE-020, CHAT-BE-021, CHAT-BE-022, CHAT-BE-029, CHAT-BE-030, CHAT-BE-031, CHAT-BE-032, CHAT-BE-037, CHAT-BE-038
export function createTripChatHandler({
  repository,
  rateLimiter,
  model,
  modelName,
  timeoutMs,
  clock = () => new Date(),
  logger = (event) => console.info(event),
}: Dependencies) {
  return async function POST(request: Request) {
    const contract = request.headers.get("x-trip-chat-contract");
    const contractV5 = contract === "5";
    const contractV4 = contract === "4";
    const contractV3 = contract === "3";
    const currentContract = contractV3 || contractV4 || contractV5;
    const contractV2 = contract === "2";
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
          25,
          10 * 60_000,
          now.getTime(),
        ),
        rateLimiter.check(
          `chat-day:${tripHash}:${day}`,
          250,
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

    const maximumBodyBytes = currentContract ? 32 * 1024 : 16 * 1024;
    const raw = await readBody(request, maximumBodyBytes);
    if ("oversized" in raw)
      return error(
        "body-too-large",
        `Request body exceeds ${currentContract ? 32 : 16} KiB`,
        413,
      );
    if (!("value" in raw))
      return error("invalid-json", "Invalid JSON body", 400);
    const requestSchema = currentContract
      ? tripChatRequestSchema
      : tripChatRequestV2Schema;
    const parsed = requestSchema.safeParse(raw.value);
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
      const explicitAddition = hasExplicitAdditionIntent(parsed.data.message);
      const cardMode =
        currentContract &&
        "createCards" in parsed.data &&
        parsed.data.createCards === true;
      const linkMode =
        !cardMode && hasExplicitLinkEnrichmentIntent(parsed.data.message);
      const scheduleMode =
        !cardMode &&
        !linkMode &&
        (contractV4 || contractV5) &&
        hasScheduleIntent(parsed.data.message, parsed.data.history);
      const additionMode =
        !cardMode &&
        !linkMode &&
        !scheduleMode &&
        currentContract &&
        explicitAddition;
      const batchMode = cardMode || additionMode;
      const savedPlaceLookup =
        hasExplicitSavedPlaceLookupIntent(parsed.data.message) ||
        (!contractV3 && explicitAddition);
      const modelMode = cardMode
        ? "card"
        : linkMode
          ? "link"
          : scheduleMode
            ? contractV5
              ? "schedule-new"
              : "schedule"
            : additionMode
              ? "addition"
              : "standard";
      const schedulingThread = scheduleMode
        ? [
            ...parsed.data.history.map((item) => item.content),
            parsed.data.message,
          ].join("\n")
        : "";
      const context = buildTripChatContext(trip, clock(), schedulingThread);
      const generated = await withTimeout(
        (signal) =>
          model.generate({
            message: parsed.data.message,
            history: parsed.data.history,
            context,
            mode: modelMode,
            signal,
          }),
        timeoutMs ?? (batchMode ? 45_000 : 20_000),
      );
      usage = generated.usage;
      const output = tripChatCandidateResponseSchema.safeParse(
        generated.output,
      );
      if (!output.success)
        throw new TripChatInvalidOutputError("Invalid model output");
      const boundedIds = new Set(context.places.map((place) => place.id));
      const authoritativeIds = new Set(trip.places.map((place) => place.id));
      const savedPlaceIds = (
        scheduleMode
          ? []
          : batchMode || linkMode || savedPlaceLookup
            ? output.data.savedPlaceIds
            : []
      )
        .filter(
          (id, index, ids) =>
            ids.indexOf(id) === index &&
            boundedIds.has(id) &&
            authoritativeIds.has(id),
        )
        .slice(0, batchMode || linkMode ? 12 : 3);
      const existingPlaceKeys = new Set(
        trip.places.map((place) =>
          normalizedPlaceKey(place.name, place.locality),
        ),
      );
      const searchedUrls = suppliedHttpsUrls(generated.sources ?? []);
      const suggestions: (typeof output.data.suggestions)[number][] = [];
      const suggestionKeys = new Set<string>();
      if (
        !scheduleMode &&
        (batchMode || (!linkMode && savedPlaceIds.length === 0))
      ) {
        for (const suggestion of output.data.suggestions) {
          const key = normalizedPlaceKey(suggestion.name, suggestion.locality);
          if (existingPlaceKeys.has(key) || suggestionKeys.has(key)) continue;
          const sourceUrl =
            suggestion.sourceUrl !== null &&
            searchedUrls.has(suggestion.sourceUrl)
              ? suggestion.sourceUrl
              : null;
          if (!batchMode && sourceUrl === null) continue;
          suggestionKeys.add(key);
          suggestions.push({ ...suggestion, sourceUrl });
          if (suggestions.length >= (batchMode ? 12 : 3)) break;
        }
      }
      const rawScheduledItem =
        scheduleMode && output.data.scheduledItem
          ? output.data.scheduledItem
          : null;
      const scheduleDateIsValid = Boolean(
        rawScheduledItem &&
        rawScheduledItem.date >= trip.startDate &&
        rawScheduledItem.date <= trip.endDate,
      );
      const duplicateScheduledPlace = rawScheduledItem?.suggestion
        ? trip.places.find(
            (place) =>
              boundedIds.has(place.id) &&
              normalizedPlaceKey(place.name, place.locality) ===
                normalizedPlaceKey(
                  rawScheduledItem.suggestion?.name,
                  rawScheduledItem.suggestion?.locality,
                ),
          )
        : null;
      const scheduledPlaceId =
        rawScheduledItem?.savedPlaceId ?? duplicateScheduledPlace?.id ?? null;
      const scheduleDuration =
        rawScheduledItem?.durationMinutes ?? (contractV5 ? 120 : null);
      const scheduleCandidate = rawScheduledItem
        ? scheduledPlaceId &&
          authoritativeIds.has(scheduledPlaceId) &&
          boundedIds.has(scheduledPlaceId) &&
          scheduleDuration !== null &&
          scheduleDateIsValid
          ? {
              ...rawScheduledItem,
              savedPlaceId: scheduledPlaceId,
              suggestion: null,
              durationMinutes: scheduleDuration,
            }
          : contractV5 && rawScheduledItem.suggestion && scheduleDateIsValid
            ? {
                ...rawScheduledItem,
                savedPlaceId: null,
                suggestion: {
                  ...rawScheduledItem.suggestion,
                  sourceUrl:
                    rawScheduledItem.suggestion.sourceUrl !== null &&
                    searchedUrls.has(rawScheduledItem.suggestion.sourceUrl)
                      ? rawScheduledItem.suggestion.sourceUrl
                      : null,
                },
                durationMinutes: scheduleDuration ?? 120,
              }
            : null
        : null;
      const resultBudgetAfterSuggestions = Math.max(
        0,
        12 - savedPlaceIds.length - suggestions.length,
      );
      const resolvedNames = new Set(
        [
          ...savedPlaceIds.flatMap((id) => {
            const place = trip.places.find((candidate) => candidate.id === id);
            return place ? [place.name] : [];
          }),
          ...suggestions.map((suggestion) => suggestion.name),
        ].map((name) => normalizedPlaceKey(name, null)),
      );
      const unresolvedPlaceNames: string[] = [];
      const unresolvedKeys = new Set<string>();
      if (batchMode) {
        for (const unresolvedName of output.data.unresolvedPlaceNames) {
          const key = normalizedPlaceKey(unresolvedName, null);
          if (resolvedNames.has(key) || unresolvedKeys.has(key)) continue;
          unresolvedKeys.add(key);
          unresolvedPlaceNames.push(unresolvedName);
          if (unresolvedPlaceNames.length >= resultBudgetAfterSuggestions)
            break;
        }
      }
      const savedIdSet = new Set(savedPlaceIds);
      const sourceCandidates = linkMode
        ? output.data.savedPlaceSources.filter((candidate) => {
            if (!savedIdSet.has(candidate.savedPlaceId)) return false;
            const place = trip.places.find(
              (item) => item.id === candidate.savedPlaceId,
            );
            return (
              place?.sourceUrl === null && searchedUrls.has(candidate.sourceUrl)
            );
          })
        : [];
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
        suggestions: batchMode
          ? suggestions.slice(0, Math.max(0, 12 - finalSavedPlaceIds.length))
          : linkMode || finalSavedPlaceIds.length > 0
            ? []
            : suggestions,
        unresolvedPlaceNames: batchMode
          ? unresolvedPlaceNames.slice(
              0,
              Math.max(0, 12 - finalSavedPlaceIds.length - suggestions.length),
            )
          : [],
        tripVersion: responseTrip.version,
      });
      if (!response.success)
        throw new TripChatInvalidOutputError("Invalid normalized model output");
      if (contractV5) {
        const v5 = tripChatResponseV5Schema.safeParse({
          ...response.data,
          suggestions: scheduleMode ? [] : response.data.suggestions,
          unresolvedPlaceNames: scheduleMode
            ? []
            : response.data.unresolvedPlaceNames,
          scheduleCandidate,
        });
        if (!v5.success)
          throw new TripChatInvalidOutputError("Invalid schedule response");
        return result(v5.data);
      }
      if (contractV4) {
        const v4 = tripChatResponseV4Schema.safeParse({
          ...response.data,
          suggestions: scheduleMode ? [] : response.data.suggestions,
          unresolvedPlaceNames: scheduleMode
            ? []
            : response.data.unresolvedPlaceNames,
          scheduledItem:
            scheduleCandidate?.savedPlaceId && !scheduleCandidate.suggestion
              ? {
                  savedPlaceId: scheduleCandidate.savedPlaceId,
                  date: scheduleCandidate.date,
                  startTime: scheduleCandidate.startTime,
                  durationMinutes: scheduleCandidate.durationMinutes,
                }
              : null,
        });
        if (!v4.success)
          throw new TripChatInvalidOutputError("Invalid schedule response");
        return result(v4.data);
      }
      if (contractV3) return result(response.data);
      const compatible = tripChatResponseV2Schema.safeParse({
        message: response.data.message,
        savedPlaceIds: response.data.savedPlaceIds.slice(0, 3),
        suggestions: response.data.suggestions.slice(0, 3),
        tripVersion: response.data.tripVersion,
      });
      if (!compatible.success)
        throw new TripChatInvalidOutputError("Invalid compatible response");
      if (!contractV2) {
        const legacyResponse = {
          message: compatible.data.message,
          suggestions: compatible.data.suggestions,
        };
        return result(legacyResponse);
      }
      return result(compatible.data);
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
