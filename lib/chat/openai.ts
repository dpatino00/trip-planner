import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

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
Search the saved places in the authoritative context first. Rank useful matches for the traveler's current request by their names, summaries, interests, and tags, and return up to three unique IDs in savedPlaceIds, most relevant first. If there is at least one useful saved match, return no new suggestions. If every saved match already has a source URL, return an empty savedPlaceSources array and do not invoke web search. If any saved match is missing a source URL, you MUST invoke web search once for all missing matched-place links together. For each credible exact match, copy an exact HTTPS URL from the current search sources into savedPlaceSources with that place's savedPlaceId and sourceUrl. Do not return source candidates for places that were not included in savedPlaceIds or that already have a source URL. Do not claim that a source was saved because the server validates and persists it after generation.
Only when no saved place is useful, return an empty savedPlaceIds array and suggest up to three new places. For any new-place suggestion, you MUST invoke web search first. Write a concise one- or two-sentence summary explaining what the place is, why someone might visit, and its relevant character, cuisine, or experience. Use unique normalized lower-case tags such as mexican, seafood, casual, or outdoor. Use no more than one web search call to find one trustworthy reference for all new suggestions together. Prefer each place's official venue, park, museum, government, or tourism page. Copy an exact HTTPS URL from the search sources into sourceUrl for each suggestion whenever a credible source exists; do not put the URL only in the narrative. Use null only when the search returns no credible matching source. Do not search for narrative-only answers. Do not claim other live venue facts. Suggestions remain reviewable until the traveler adds them.`;

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
// @spec CHAT-DATA-001, CHAT-DATA-006, CHAT-BE-001, CHAT-BE-010, CHAT-BE-012, CHAT-API-010, SEC-API-007
export function createOpenAITripChatModel(options: {
  client: ResponsesClient;
  model: string;
}): TripChatModel {
  return {
    async generate(input) {
      const response = await options.client.responses.parse(
        {
          model: options.model,
          store: false,
          max_output_tokens: 1600,
          max_tool_calls: 1,
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
