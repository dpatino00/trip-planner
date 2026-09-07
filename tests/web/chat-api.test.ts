// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTripChatHandler } from "@/lib/chat/handlers";
import type { TripChatModel } from "@/lib/chat/model";
import { tripChatResponseSchema } from "@/lib/chat/schema";
import { createMemoryRateLimiter } from "@/lib/trips/rate-limit";
import { createMemoryTripRepository } from "@/lib/trips/repository-memory";
import { tripKeyForToken } from "@/lib/trips/token";
import { makeTripV2, SHARE_TOKEN } from "./fixtures";

const suggestion = {
  name: "La Jolla Cove",
  summary: "A compact coastal stop for views and wildlife.",
  locality: "La Jolla",
  interests: ["coast", "wildlife"],
  tags: ["coast", "sea lions"],
  profile: "coastal",
  preferredDayparts: ["morning"],
  durationMinutes: 90,
  costLevel: 0,
  reservationRecommended: false,
  sourceUrl: null,
};

function chatRequest(
  body: unknown,
  options: { token?: string; ip?: string; raw?: string } = {},
) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": options.ip ?? "203.0.113.10",
  });
  if (options.token !== undefined) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  return new Request("https://trip.test/api/trip/chat", {
    method: "POST",
    headers,
    body: options.raw ?? JSON.stringify(body),
  });
}

async function setup(
  options: {
    model?: TripChatModel | null;
    timeoutMs?: number;
    trip?: ReturnType<typeof makeTripV2>;
  } = {},
) {
  const repository = createMemoryTripRepository();
  await repository.create(tripKeyForToken(SHARE_TOKEN), {
    trip: options.trip ?? makeTripV2(),
    recentMutationIds: [],
  });
  const model =
    options.model === undefined
      ? {
          generate: vi.fn().mockResolvedValue({
            output: {
              message: "Try the coast this morning.",
              savedPlaceIds: [],
              suggestions: [suggestion],
            },
            usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
          }),
        }
      : options.model;
  const logger = vi.fn();
  const POST = createTripChatHandler({
    repository,
    rateLimiter: createMemoryRateLimiter(),
    model,
    modelName: "gpt-test",
    timeoutMs: options.timeoutMs,
    clock: () => new Date("2026-09-06T12:00:00Z"),
    logger,
  });
  return { POST, repository, model, logger };
}

beforeEach(() => vi.restoreAllMocks());

// @spec CHAT-API-001, CHAT-DATA-002, CHAT-DATA-003, CHAT-BE-002, CHAT-BE-008, SEC-DATA-008
it("loads authoritative bounded context, logs metadata, and never mutates the trip", async () => {
  const { POST, repository, model, logger } = await setup();
  const get = vi.spyOn(repository, "get");
  const update = vi.spyOn(repository, "update");
  const create = vi.spyOn(repository, "create");
  const remove = vi.spyOn(repository, "delete");

  const response = await POST(
    chatRequest(
      { message: "What fits this morning?", history: [] },
      { token: SHARE_TOKEN },
    ),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    message: "Try the coast this morning.",
    savedPlaceIds: [],
    suggestions: [suggestion],
  });
  expect(get).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  const input = vi.mocked(model!.generate).mock.calls[0][0];
  expect(input.context.title).toBe(makeTripV2().title);
  expect(input.context.places[0]).toMatchObject({
    id: "place-balboa-park",
    summary: "Gardens, museums, and architecture.",
    tags: ["gardens", "museum"],
  });
  expect(JSON.stringify(input.context)).not.toContain(SHARE_TOKEN);
  expect(input.context).not.toHaveProperty("expiresAt");
  expect(JSON.stringify(input.context)).not.toMatch(
    /createdAt|updatedAt|recentMutationIds|trip:v1/,
  );
  expect(logger).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "trip_chat",
      model: "gpt-test",
      status: 200,
      tripHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    }),
  );
  expect(JSON.stringify(logger.mock.calls)).not.toContain("What fits");
  expect(JSON.stringify(logger.mock.calls)).not.toContain(SHARE_TOKEN);
});

// @spec CHAT-API-002, CHAT-API-003
it("authenticates before storage and distinguishes an unknown trip", async () => {
  const { POST, repository } = await setup();
  const get = vi.spyOn(repository, "get");
  expect((await POST(chatRequest({ message: "Hi", history: [] }))).status).toBe(
    401,
  );
  expect(get).not.toHaveBeenCalled();

  const unknown = "BBBBBBBBBBBBBBBBBBBBBB";
  expect(
    (
      await POST(
        chatRequest({ message: "Hi", history: [] }, { token: unknown }),
      )
    ).status,
  ).toBe(404);
});

// @spec CHAT-API-004, CHAT-API-005
describe("chat input boundaries", () => {
  it.each([
    { message: "", history: [] },
    { message: "x".repeat(2001), history: [] },
    {
      message: "hi",
      history: Array.from({ length: 9 }, () => ({
        role: "user",
        content: "x",
      })),
    },
    { message: "hi", history: [], unknown: true },
  ])("rejects invalid input without calling the model", async (body) => {
    const { POST, model } = await setup();
    const response = await POST(chatRequest(body, { token: SHARE_TOKEN }));
    expect(response.status).toBe(400);
    expect(model!.generate).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies and the exact credential in content", async () => {
    const { POST, model } = await setup();
    const oversized = await POST(
      chatRequest({}, { token: SHARE_TOKEN, raw: "x".repeat(16 * 1024 + 1) }),
    );
    expect(oversized.status).toBe(413);
    const leaked = await POST(
      chatRequest(
        { message: `Use ${SHARE_TOKEN}`, history: [] },
        { token: SHARE_TOKEN },
      ),
    );
    expect(leaked.status).toBe(400);
    expect(model!.generate).not.toHaveBeenCalled();
  });
});

// @spec CHAT-API-006, CHAT-API-007
it("enforces ten-per-pair and one-hundred-per-trip allowances", async () => {
  const { POST } = await setup();
  for (let index = 0; index < 10; index += 1) {
    expect(
      (
        await POST(
          chatRequest(
            { message: "Hi", history: [] },
            { token: SHARE_TOKEN, ip: "198.51.100.1" },
          ),
        )
      ).status,
    ).toBe(200);
  }
  expect(
    (
      await POST(
        chatRequest(
          { message: "Hi", history: [] },
          { token: SHARE_TOKEN, ip: "198.51.100.1" },
        ),
      )
    ).status,
  ).toBe(429);

  const daily = await setup();
  for (let index = 0; index < 100; index += 1) {
    const ip = `198.51.100.${Math.floor(index / 10) + 1}`;
    expect(
      (
        await daily.POST(
          chatRequest(
            { message: "Hi", history: [] },
            { token: SHARE_TOKEN, ip },
          ),
        )
      ).status,
    ).toBe(200);
  }
  expect(
    (
      await daily.POST(
        chatRequest(
          { message: "Hi", history: [] },
          { token: SHARE_TOKEN, ip: "198.51.100.99" },
        ),
      )
    ).status,
  ).toBe(429);
});

// @spec CHAT-API-008, CHAT-API-009, CHAT-API-010
it("fails closed for configuration, timeout, and malformed model output", async () => {
  expect(
    (
      await (
        await setup({ model: null })
      ).POST(
        chatRequest({ message: "Hi", history: [] }, { token: SHARE_TOKEN }),
      )
    ).status,
  ).toBe(503);

  const hanging: TripChatModel = {
    generate: vi.fn(() => new Promise<never>(() => {})),
  };
  expect(
    (
      await (
        await setup({ model: hanging, timeoutMs: 1 })
      ).POST(
        chatRequest({ message: "Hi", history: [] }, { token: SHARE_TOKEN }),
      )
    ).status,
  ).toBe(504);

  const malformed: TripChatModel = {
    generate: vi.fn().mockResolvedValue({
      output: { message: "partial", savedPlaceIds: [], suggestions: [{}] },
    }),
  };
  expect(
    (
      await (
        await setup({ model: malformed })
      ).POST(
        chatRequest({ message: "Hi", history: [] }, { token: SHARE_TOKEN }),
      )
    ).status,
  ).toBe(502);
});

// @spec CHAT-DATA-001, CHAT-BE-009, SEC-API-006
it("keeps web-search sources and removes ungrounded model URLs", async () => {
  const trustedUrl = "https://www.sandiego.gov/lifeguards/beaches/cove";
  const model: TripChatModel = {
    generate: vi.fn().mockResolvedValue({
      output: {
        message: "Try this.",
        savedPlaceIds: [],
        suggestions: [
          { ...suggestion, sourceUrl: trustedUrl },
          {
            ...suggestion,
            name: "Imaginary Cove",
            sourceUrl: "https://hallucinated.example/place",
          },
        ],
      },
      sources: [trustedUrl, "http://unsafe.example/place"],
    }),
  };
  const { POST } = await setup({ model });
  const response = await POST(
    chatRequest(
      { message: "Suggest somewhere", history: [] },
      { token: SHARE_TOKEN },
    ),
  );
  const body = await response.json();
  expect(body.suggestions[0].sourceUrl).toBe(trustedUrl);
  expect(body.suggestions[1].sourceUrl).toBeNull();
});

// @spec CHAT-DATA-002, CHAT-BE-002, CHAT-BE-011
it("returns authoritative saved matches in model order and suppresses new suggestions", async () => {
  const model: TripChatModel = {
    generate: vi.fn().mockResolvedValue({
      output: {
        message: "You already saved two good fits.",
        savedPlaceIds: [
          "place-tacos",
          "not-an-authoritative-place",
          "place-balboa-park",
        ],
        suggestions: [suggestion],
      },
    }),
  };
  const { POST, repository } = await setup({ model });
  const update = vi.spyOn(repository, "update");

  const response = await POST(
    chatRequest(
      { message: "I'm feeling Mexican food", history: [] },
      { token: SHARE_TOKEN },
    ),
  );

  expect(await response.json()).toEqual({
    message: "You already saved two good fits.",
    savedPlaceIds: ["place-tacos", "place-balboa-park"],
    suggestions: [],
  });
  expect(update).not.toHaveBeenCalled();
});

// @spec CHAT-DATA-001, CHAT-DATA-002, CHAT-BE-011
it("deduplicates model IDs while enforcing uniqueness and summary quality at the public boundary", async () => {
  const duplicateIds = await setup({
    model: {
      generate: vi.fn().mockResolvedValue({
        output: {
          message: "Matches",
          savedPlaceIds: ["place-tacos", "place-tacos"],
          suggestions: [],
        },
      }),
    },
  });
  const duplicateResponse = await duplicateIds.POST(
    chatRequest({ message: "Mexican", history: [] }, { token: SHARE_TOKEN }),
  );
  expect(await duplicateResponse.json()).toMatchObject({
    savedPlaceIds: ["place-tacos"],
    suggestions: [],
  });
  expect(
    tripChatResponseSchema.safeParse({
      message: "Matches",
      savedPlaceIds: ["place-tacos", "place-tacos"],
      suggestions: [],
    }).success,
  ).toBe(false);
  expect(
    tripChatResponseSchema.safeParse({
      message: "Too many matches",
      savedPlaceIds: ["one", "two", "three", "four"],
      suggestions: [],
    }).success,
  ).toBe(false);
  expect(
    tripChatResponseSchema.safeParse({
      message: "Invalid tag",
      savedPlaceIds: [],
      suggestions: [{ ...suggestion, tags: ["Mexican"] }],
    }).success,
  ).toBe(false);

  const weakSummary = await setup({
    model: {
      generate: vi.fn().mockResolvedValue({
        output: {
          message: "A new idea",
          savedPlaceIds: [],
          suggestions: [{ ...suggestion, summary: "Nice" }],
        },
      }),
    },
  });
  expect(
    (
      await weakSummary.POST(
        chatRequest(
          { message: "Something new", history: [] },
          { token: SHARE_TOKEN },
        ),
      )
    ).status,
  ).toBe(502);
});

// @spec CHAT-DATA-003, CHAT-BE-011
it("accepts matches only from the saved places retained by bounded context", async () => {
  const base = makeTripV2();
  const places = Array.from({ length: 21 }, (_, index) => ({
    ...base.places[index % base.places.length],
    id: `bounded-place-${index}`,
    name: `Bounded place ${index}`,
  }));
  const model: TripChatModel = {
    generate: vi.fn().mockResolvedValue({
      output: {
        message: "No bounded match.",
        savedPlaceIds: ["bounded-place-20"],
        suggestions: [suggestion],
      },
    }),
  };
  const { POST } = await setup({ model, trip: { ...base, places } });

  const response = await POST(
    chatRequest(
      { message: "Find the last place", history: [] },
      { token: SHARE_TOKEN },
    ),
  );

  expect(await response.json()).toMatchObject({
    savedPlaceIds: [],
    suggestions: [suggestion],
  });
  const context = vi.mocked(model.generate).mock.calls[0][0].context;
  expect(context.places).toHaveLength(20);
  expect(context.places.some((place) => place.id === "bounded-place-20")).toBe(
    false,
  );
});
