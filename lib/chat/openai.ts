import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { hasExplicitAdditionIntent } from "@/lib/chat/intent";
import type { TripChatModel } from "@/lib/chat/model";
import { TripChatInvalidOutputError } from "@/lib/chat/model";
import { tripChatModelResponseSchema } from "@/lib/chat/schema";

type ResponsesClient = {
  responses: {
    parse: (
      body: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ) => Promise<{
      status?: string;
      output_parsed?: unknown;
      output?: unknown[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    }>;
  };
};

const instructions = `You are the embedded trip companion. Use only the supplied trip and conversation context.
Return concise, practical narrative advice. For itinerary-planning requests, explain options and direct the traveler to the existing Plan/proposal workflow; never create or claim to apply a proposal.
There are three request modes. A saved-place lookup explicitly asks about saved places, Ideas, or the current trip without asking to add places. Rank useful matches by names, summaries, interests, and tags, return up to three unique IDs in savedPlaceIds, and return no suggestions when at least one match exists. If every saved match already has a source URL, return an empty savedPlaceSources array and do not invoke web search. If any saved match is missing a source URL, you MUST invoke web search once for all missing matched-place links together. For each credible exact match, copy an exact HTTPS URL from the current search sources into savedPlaceSources with that place's savedPlaceId and sourceUrl. Do not return source candidates for places that were not included in savedPlaceIds or that already have a source URL. Do not claim that a source was saved because the server validates and persists it after generation.
For general discovery requests, suggest up to three new places and do not return savedPlaceIds, even when a saved place matches the topic. Do not suggest an exact place already present in the saved-place context. For any new-place suggestion, you MUST invoke web search first and use no more than one web search call for all suggestions together. Copy an exact HTTPS URL from the current search sources into sourceUrl for each suggestion whenever a credible source exists; do not put the URL only in the narrative. Use null only when the search returns no credible matching source; the server will omit that ungrounded discovery candidate.
An explicit addition request uses add, save, include, keep, or import language for named places. Treat names supplied in prose, a list, or a table the same way. Process the first twelve place occurrences and explain in the narrative when more were supplied. Return existing places as authoritative savedPlaceIds, missing places as suggestions, and ambiguous or unresolvable names as unresolvedPlaceNames; these groups may appear together but must contain no more than twelve results combined. Preserve the user's first-occurrence order within each group. Search for credible exact links in no more than four bulk web searches. A missing credible source must not block an explicit-addition suggestion: use null for sourceUrl so the card can still offer Maps links. Preserve useful user-provided hours, prices, and deals in the summary, clearly stating that volatile details are unverified. Never claim that generation added a place; every suggestion remains reviewable until the traveler confirms it.
For every suggestion, write a concise one- or two-sentence summary explaining what the place is, why someone might visit, and its relevant character, cuisine, or experience. Use unique normalized lower-case tags such as mexican, seafood, casual, or outdoor. Prefer each place's official venue, park, museum, government, or tourism page. Do not claim other live venue facts.`;

function webSearchSources(
  output: Awaited<ReturnType<ResponsesClient["responses"]["parse"]>>["output"],
) {
  const sources = new Set<string>();
  for (const item of output ?? []) {
    if (!item || typeof item !== "object" || !("type" in item)) continue;
    if (item.type !== "web_search_call" || !("action" in item)) continue;
    const action = item.action;
    if (!action || typeof action !== "object" || !("type" in action)) continue;
    if (action.type !== "search" || !("sources" in action)) continue;
    const rawSources = action.sources;
    if (!Array.isArray(rawSources)) continue;
    for (const source of rawSources) {
      if (!source || typeof source !== "object") continue;
      if (!("type" in source) || !("url" in source)) continue;
      if (source.type !== "url" || typeof source.url !== "string") continue;
      sources.add(source.url);
    }
  }
  return [...sources];
}

// This module is imported only by the Node route runtime and never by client components.
// @spec CHAT-DATA-001, CHAT-DATA-006, CHAT-BE-001, CHAT-BE-010, CHAT-BE-012, CHAT-BE-021, CHAT-BE-022, CHAT-BE-023, CHAT-BE-024, CHAT-API-010, SEC-API-007
export function createOpenAITripChatModel(options: {
  client: ResponsesClient;
  model: string;
}): TripChatModel {
  return {
    async generate(input) {
      const mode =
        input.mode ??
        (hasExplicitAdditionIntent(input.message) ? "addition" : "standard");
      const response = await options.client.responses.parse(
        {
          model: options.model,
          store: false,
          max_output_tokens: mode === "addition" ? 5000 : 1600,
          max_tool_calls: mode === "addition" ? 4 : 1,
          include: ["web_search_call.action.sources"],
          tools: [{ type: "web_search", search_context_size: "low" }],
          input: [
            { role: "system", content: instructions },
            {
              role: "system",
              content: `Authoritative trip context:\n${JSON.stringify(input.context)}`,
            },
            ...input.history,
            { role: "user", content: input.message },
          ],
          text: {
            format: zodTextFormat(
              tripChatModelResponseSchema,
              "trip_chat_response",
            ),
          },
        },
        { signal: input.signal },
      );
      if (response.status !== "completed" || !response.output_parsed) {
        throw new TripChatInvalidOutputError(
          "Model response was incomplete or refused",
        );
      }
      return {
        output: response.output_parsed,
        sources: webSearchSources(response.output),
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}

export function createConfiguredOpenAITripChatModel(options: {
  apiKey: string;
  model: string;
}) {
  return createOpenAITripChatModel({
    // Let the route's bounded timeout report the provider error promptly.
    // Automatic SDK retries can otherwise make a single local request appear
    // to hang and obscure whether the key/model is accepted.
    client: new OpenAI({ apiKey: options.apiKey, maxRetries: 0 }),
    model: options.model,
  });
}
