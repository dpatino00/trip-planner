import type { TripChatContext } from "@/lib/chat/context";
import type { TripChatRequest } from "@/lib/chat/schema";

export interface TripChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface TripChatModelResult {
  output: unknown;
  sources?: string[];
  usage?: TripChatUsage;
}

export interface TripChatModel {
  generate(input: {
    message: string;
    history: TripChatRequest["history"];
    context: TripChatContext;
    mode?:
      "standard" | "addition" | "card" | "link" | "schedule" | "schedule-new";
    signal?: AbortSignal;
  }): Promise<TripChatModelResult>;
}

export class TripChatInvalidOutputError extends Error {}
