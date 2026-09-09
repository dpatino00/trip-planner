import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  hasExplicitAdditionIntent,
  hasExplicitLinkEnrichmentIntent,
} from "@/lib/chat/intent";
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
There are four request modes. Follow the Request mode supplied by the system.
In standard mode, a saved-idea lookup explicitly asks about saved places, Ideas, or the current trip without asking to add ideas or find links. Rank useful matches by names, summaries, interests, and tags, return up to three unique IDs in savedPlaceIds, return no suggestions when at least one match exists, leave savedPlaceSources empty, and do not enrich when the traveler merely mentions a saved idea.
For general discovery requests, suggest up to three new places and do not return savedPlaceIds, even when a saved place matches the topic. Do not suggest an exact place already present in the saved-place context. For any new-place suggestion, you MUST invoke web search first and use no more than one web search call for all suggestions together. Copy an exact HTTPS URL from the current search sources into sourceUrl for each suggestion whenever a credible source exists; do not put the URL only in the narrative. Use null only when the search returns no credible matching source; the server will omit that ungrounded discovery candidate.
An explicit addition request uses add, save, include, keep, or import language for named places. Treat names supplied in prose, a list, or a table the same way. Process the first twelve place occurrences and explain in the narrative when more were supplied. Return existing places as authoritative savedPlaceIds, missing places as suggestions, and ambiguous or unresolvable names as unresolvedPlaceNames; these groups may appear together but must contain no more than twelve results combined. Preserve the user's first-occurrence order within each group. Search for credible exact links in no more than four bulk web searches. A missing credible source must not block an explicit-addition suggestion: use null for sourceUrl so the card can still offer Maps links. Preserve useful user-provided hours, prices, and deals in the summary, clearly stating that volatile details are unverified. Never claim that generation added a place; every suggestion remains reviewable until the traveler confirms it.
In card mode, create cards only for the first twelve named places, events, or activities in the current user message. Do not create cards for unnamed ideas in an open-ended request. Return existing ideas as authoritative savedPlaceIds, missing named ideas as suggestions, and ambiguous or unresolvable names as unresolvedPlaceNames. These groups may appear together but must contain no more than twelve results combined. Search for credible exact links in no more than four bulk web searches, but retain an identifiable card without a source by using null for sourceUrl. Preserve supplied dates, times, venues, prices, deals, and character in the concise summary while marking volatile details unverified. Never claim that creating a card saved it.
In link mode, the traveler explicitly requests a link, URL, website, or source for one or more named saved ideas. Return only matching authoritative IDs in savedPlaceIds, return no new suggestions or unresolvedPlaceNames, and invoke no more than one web search for all missing links. For each credible exact match whose saved context has no source URL, copy an exact HTTPS URL from the current search sources into savedPlaceSources. Do not return a source candidate for an idea not included in savedPlaceIds or for one that already has a source URL. Do not claim that a source was saved because the server validates and persists it after generation.
For every suggestion, write a concise one- or two-sentence summary explaining what the trip idea is, why someone might choose it, and its relevant character, cuisine, or experience. Use unique normalized lower-case tags such as theater, mexican, seafood, casual, event, or outdoor. Prefer an official venue, event, park, museum, government, or tourism page. Do not claim other live venue or event facts.`;

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
// @spec CHAT-DATA-001, CHAT-DATA-005, CHAT-DATA-006, CHAT-BE-001, CHAT-BE-010, CHAT-BE-012, CHAT-BE-021, CHAT-BE-022, CHAT-BE-023, CHAT-BE-024, CHAT-BE-029, CHAT-BE-030, CHAT-BE-031, CHAT-BE-032, CHAT-API-010, SEC-API-007
export function createOpenAITripChatModel(options: {
  client: ResponsesClient;
  model: string;
}): TripChatModel {
  return {
    async generate(input) {
      const mode =
        input.mode ??
        (hasExplicitLinkEnrichmentIntent(input.message)
          ? "link"
          : hasExplicitAdditionIntent(input.message)
            ? "addition"
            : "standard");
      const batchMode = mode === "addition" || mode === "card";
      const response = await options.client.responses.parse(
        {
          model: options.model,
          store: false,
          max_output_tokens: batchMode ? 5000 : 1600,
          max_tool_calls: batchMode ? 4 : 1,
          include: ["web_search_call.action.sources"],
          tools: [{ type: "web_search", search_context_size: "low" }],
          input: [
            { role: "system", content: instructions },
            { role: "system", content: `Request mode: ${mode}` },
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
