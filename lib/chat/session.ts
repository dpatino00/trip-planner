import { z } from "zod";

import { suggestedPlaceSchema } from "@/lib/chat/schema";
import type { SuggestedPlace } from "@/lib/types";

export interface ChatSessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  savedPlaceIds: string[];
  suggestions: SuggestedPlace[];
}

const sessionSchema = z
  .object({
    version: z.literal(2),
    messages: z
      .array(
        z
          .object({
            id: z.string().min(1),
            role: z.enum(["user", "assistant"]),
            content: z.string().max(2000),
            savedPlaceIds: z
              .array(z.string().trim().min(1).max(120))
              .max(3)
              .refine((values) => new Set(values).size === values.length),
            suggestions: z.array(suggestedPlaceSchema).max(3),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

async function tokenHash(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function chatSessionStorageKey(token: string) {
  return `trip-chat:v2:${await tokenHash(token)}`;
}

// @spec CHAT-DATA-004, SEC-DATA-007
export async function saveChatSession(
  token: string,
  messages: ChatSessionMessage[],
) {
  try {
    const key = await chatSessionStorageKey(token);
    const safe = messages.slice(-12).map((message) => ({
      ...message,
      content: message.content.replaceAll(token, "[private trip link removed]"),
    }));
    sessionStorage.setItem(key, JSON.stringify({ version: 2, messages: safe }));
  } catch {
    // Session persistence is best effort.
  }
}

export async function loadChatSession(
  token: string,
): Promise<ChatSessionMessage[]> {
  try {
    const key = await chatSessionStorageKey(token);
    sessionStorage.removeItem(`trip-chat:v1:${await tokenHash(token)}`);
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      sessionStorage.removeItem(key);
      return [];
    }
    return parsed.data.messages;
  } catch {
    return [];
  }
}
