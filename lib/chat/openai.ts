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
You may suggest up to three places. When you return place suggestions, use no more than one web search call to find one trustworthy reference for all suggestions together. Prefer each place's official venue, park, museum, government, or tourism page. Copy an exact HTTPS URL from the search sources into sourceUrl; use null when no credible matching source exists. Do not search for narrative-only answers. Do not claim other live venue facts. Suggestions remain reviewable until the traveler adds them.`;

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
// @spec CHAT-BE-001, CHAT-API-010, SEC-API-007
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
    client: new OpenAI({ apiKey: options.apiKey }),
    model: options.model,
  });
}
