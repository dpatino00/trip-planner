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
You may suggest up to three places. Do not use tools, browse, fetch URLs, or claim live venue facts. A sourceUrl must be null unless that exact HTTPS URL appears in the supplied context. Suggestions are unverified until the traveler reviews them.`;

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
