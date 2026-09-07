import { buildTripChatContext } from "@/lib/chat/context";
import type { TripChatModel, TripChatUsage } from "@/lib/chat/model";
import { TripChatInvalidOutputError } from "@/lib/chat/model";
import {
  tripChatRequestSchema,
  tripChatResponseSchema,
} from "@/lib/chat/schema";
import { migrateTripDocument } from "@/lib/trips/migrate";
import type { RateLimiter } from "@/lib/trips/rate-limit";
import type { TripRepository } from "@/lib/trips/repository-memory";
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

// @spec CHAT-API-001, CHAT-API-002, CHAT-API-003, CHAT-API-004, CHAT-API-005, CHAT-API-006, CHAT-API-007, CHAT-API-008, CHAT-API-009, CHAT-API-010, CHAT-BE-002, CHAT-BE-008
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
      const context = buildTripChatContext(migrateTripDocument(stored.trip));
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
      const output = tripChatResponseSchema.safeParse(generated.output);
      if (!output.success)
        throw new TripChatInvalidOutputError("Invalid model output");
      const permittedUrls = suppliedHttpsUrls([
        JSON.stringify(context),
        parsed.data.message,
        ...parsed.data.history.map((item) => item.content),
        ...(generated.sources ?? []),
      ]);
      return result({
        ...output.data,
        suggestions: output.data.suggestions.map((suggestion) => ({
          ...suggestion,
          sourceUrl:
            suggestion.sourceUrl && permittedUrls.has(suggestion.sourceUrl)
              ? suggestion.sourceUrl
              : null,
        })),
      });
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
