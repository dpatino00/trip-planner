import { z } from "zod";

import {
  scheduleCandidateSchema,
  suggestedPlaceSchema,
} from "@/lib/chat/schema";
import type { SuggestedPlace } from "@/lib/types";

export interface ChatSessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  savedPlaceIds: string[];
  suggestions: SuggestedPlace[];
  unresolvedPlaceNames: string[];
  scheduleCandidate?: z.infer<typeof scheduleCandidateSchema> | null;
}

const uniqueNormalizedStrings = (values: string[]) =>
  new Set(
    values.map((value) =>
      value.trim().replace(/\s+/g, " ").toLocaleLowerCase(),
    ),
  ).size === values.length;

const sessionMessageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    content: z.string().max(8000),
    savedPlaceIds: z
      .array(z.string().trim().min(1).max(120))
      .max(12)
      .refine((values) => new Set(values).size === values.length),
    suggestions: z.array(suggestedPlaceSchema).max(12),
    unresolvedPlaceNames: z
      .array(z.string().trim().min(1).max(120))
      .max(12)
      .refine(uniqueNormalizedStrings),
    scheduleCandidate: scheduleCandidateSchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.role === "assistant" && value.content.length > 2000) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Assistant message exceeds 2,000 characters",
      });
    }
    if (
      value.savedPlaceIds.length +
        value.suggestions.length +
        value.unresolvedPlaceNames.length +
        (value.scheduleCandidate ? 1 : 0) >
      12
    ) {
      context.addIssue({
        code: "custom",
        message: "Session message exceeds twelve combined results",
      });
    }
  });

const sessionSchema = z
  .object({
    version: z.literal(5),
    messages: z.array(sessionMessageSchema).max(12),
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
  return `trip-chat:v5:${await tokenHash(token)}`;
}

export async function clearChatSession(token: string) {
  try {
    const hash = await tokenHash(token);
    sessionStorage.removeItem(`trip-chat:v5:${hash}`);
    sessionStorage.removeItem(`trip-chat:v4:${hash}`);
    sessionStorage.removeItem(`trip-chat:v3:${hash}`);
    sessionStorage.removeItem(`trip-chat:v1:${hash}`);
    sessionStorage.removeItem(`trip-chat:v2:${hash}`);
  } catch {
    // Session persistence is best effort.
  }
}

// @spec CHAT-DATA-004, CHAT-DATA-008, CHAT-DATA-014, SEC-DATA-007
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
    sessionStorage.setItem(key, JSON.stringify({ version: 5, messages: safe }));
  } catch {
    // Session persistence is best effort.
  }
}

export async function loadChatSession(
  token: string,
): Promise<ChatSessionMessage[]> {
  try {
    const key = await chatSessionStorageKey(token);
    const hash = await tokenHash(token);
    sessionStorage.removeItem(`trip-chat:v1:${hash}`);
    sessionStorage.removeItem(`trip-chat:v2:${hash}`);
    sessionStorage.removeItem(`trip-chat:v3:${hash}`);
    sessionStorage.removeItem(`trip-chat:v4:${hash}`);
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
