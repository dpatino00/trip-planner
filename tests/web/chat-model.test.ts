// @vitest-environment node

import { expect, it, vi } from "vitest";

import { createOpenAITripChatModel } from "@/lib/chat/openai";
import { makeTripV2 } from "./fixtures";

// @spec CHAT-DATA-001, CHAT-DATA-005, CHAT-DATA-006, CHAT-BE-001, CHAT-BE-003, CHAT-BE-009, CHAT-BE-010, CHAT-BE-012, CHAT-BE-013, CHAT-API-010, SEC-API-007
it("uses strict Responses parsing with one bounded web search", async () => {
  const sourceUrl = "https://www.sandiego.gov/lifeguards/beaches/cove";
  const parse = vi.fn().mockResolvedValue({
    status: "completed",
    output_parsed: {
      message: "A concise answer",
      savedPlaceIds: [],
      savedPlaceSources: [],
      suggestions: [],
      unresolvedPlaceNames: [],
    },
    output: [
      {
        type: "web_search_call",
        action: {
          type: "search",
          sources: [{ type: "url", url: sourceUrl }],
        },
      },
    ],
    usage: { input_tokens: 42, output_tokens: 12, total_tokens: 54 },
  });
  const model = createOpenAITripChatModel({
    client: { responses: { parse } },
    model: "gpt-test",
  });

  const result = await model.generate({
    message: "What should we do?",
    history: [],
    context: {
      title: makeTripV2().title,
      destination: makeTripV2().destination,
      dates: { start: makeTripV2().startDate, end: makeTripV2().endDate },
      preferences: makeTripV2().preferences,
      places: [],
      itinerary: [],
      pendingProposal: null,
    },
  });

  expect(parse).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "gpt-test",
      store: false,
      max_output_tokens: 1600,
      max_tool_calls: 1,
      include: ["web_search_call.action.sources"],
      tools: [{ type: "web_search", search_context_size: "low" }],
      text: expect.objectContaining({ format: expect.any(Object) }),
    }),
    expect.anything(),
  );
  expect(JSON.stringify(parse.mock.calls[0][0])).toMatch(
    /Plan\/proposal workflow/,
  );
  expect(JSON.stringify(parse.mock.calls[0][0])).toMatch(
    /official.*reference/i,
  );
  expect(JSON.stringify(parse.mock.calls[0][0])).toMatch(
    /general discovery.*new places|explicitly asks.*saved/i,
  );
  expect(JSON.stringify(parse.mock.calls[0][0])).toMatch(
    /saved match.*missing.*source URL.*must.*web search/i,
  );
  expect(JSON.stringify(parse.mock.calls[0][0])).toMatch(
    /saved match.*already.*source URL.*do not.*web search/i,
  );
  expect(JSON.stringify(parse.mock.calls[0][0])).toMatch(
    /savedPlaceSources.*savedPlaceId.*sourceUrl/i,
  );
  expect(JSON.stringify(parse.mock.calls[0][0])).toMatch(
    /one- or two-sentence.*summary.*normalized.*tags/i,
  );
  expect(JSON.stringify(parse.mock.calls[0][0])).toMatch(
    /must invoke web search.*sourceUrl.*do not put the URL only in the narrative/i,
  );
  expect(result).toEqual({
    output: {
      message: "A concise answer",
      savedPlaceIds: [],
      savedPlaceSources: [],
      suggestions: [],
      unresolvedPlaceNames: [],
    },
    sources: [sourceUrl],
    usage: { inputTokens: 42, outputTokens: 12, totalTokens: 54 },
  });
});

// @spec CHAT-DATA-006, CHAT-BE-001, CHAT-BE-021, CHAT-BE-022, CHAT-BE-023, CHAT-BE-024, SEC-API-007
it("uses the larger bounded model budget for free-form addition batches", async () => {
  const parse = vi.fn().mockResolvedValue({
    status: "completed",
    output_parsed: {
      message: "Review these additions.",
      savedPlaceIds: [],
      savedPlaceSources: [],
      suggestions: [],
      unresolvedPlaceNames: ["A venue needing clarification"],
    },
    output: [],
  });
  const model = createOpenAITripChatModel({
    client: { responses: { parse } },
    model: "gpt-test",
  });

  await model.generate({
    message:
      "Please import La Puerta — Gaslamp, Ironside Fish & Oyster — Little Italy, and ten more places from my notes.",
    history: [],
    context: {
      title: makeTripV2().title,
      destination: makeTripV2().destination,
      dates: { start: makeTripV2().startDate, end: makeTripV2().endDate },
      preferences: makeTripV2().preferences,
      places: [],
      itinerary: [],
      pendingProposal: null,
    },
  });

  expect(parse).toHaveBeenCalledWith(
    expect.objectContaining({
      store: false,
      max_output_tokens: 5000,
      max_tool_calls: 4,
      tools: [{ type: "web_search", search_context_size: "low" }],
    }),
    expect.anything(),
  );
  const request = JSON.stringify(parse.mock.calls[0][0]);
  expect(request).toMatch(/prose.*list.*table/i);
  expect(request).toMatch(/twelve|12/);
  expect(request).toMatch(/hours.*prices.*deals|prices.*deals.*hours/i);
  expect(request).toMatch(/unresolvedPlaceNames/);
  expect(request).toMatch(
    /savedPlaceIds.*suggestions|suggestions.*savedPlaceIds/i,
  );
});

// @spec CHAT-BE-021
it("does not treat ordinary save or keep language as a place-addition batch", async () => {
  const parse = vi.fn().mockResolvedValue({
    status: "completed",
    output_parsed: {
      message: "A concise answer",
      savedPlaceIds: [],
      savedPlaceSources: [],
      suggestions: [],
      unresolvedPlaceNames: [],
    },
    output: [],
  });
  const model = createOpenAITripChatModel({
    client: { responses: { parse } },
    model: "gpt-test",
  });

  await model.generate({
    message: "How can we save money and keep afternoons flexible?",
    history: [],
    context: {} as never,
  });

  expect(parse).toHaveBeenCalledWith(
    expect.objectContaining({ max_output_tokens: 1600, max_tool_calls: 1 }),
    expect.anything(),
  );
});

it("rejects incomplete or refused responses", async () => {
  const parse = vi.fn().mockResolvedValue({
    status: "incomplete",
    output_parsed: null,
  });
  const model = createOpenAITripChatModel({
    client: { responses: { parse } },
    model: "gpt-test",
  });
  await expect(
    model.generate({ message: "Hi", history: [], context: {} as never }),
  ).rejects.toThrow("Model response was incomplete or refused");
});
