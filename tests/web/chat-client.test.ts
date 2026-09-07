import { expect, it } from "vitest";

import {
  chatSessionStorageKey,
  loadChatSession,
  saveChatSession,
} from "@/lib/chat/session";
import { SHARE_TOKEN } from "./fixtures";

// @spec CHAT-DATA-004, SEC-DATA-007
it("stores at most twelve versioned messages under a hash-derived session key", async () => {
  const messages = Array.from({ length: 14 }, (_, index) => ({
    id: String(index),
    role: (index % 2 ? "assistant" : "user") as "assistant" | "user",
    content: index === 13 ? `secret ${SHARE_TOKEN}` : `message ${index}`,
    savedPlaceIds: index === 13 ? ["place-tacos"] : [],
    suggestions: [],
  }));

  await saveChatSession(SHARE_TOKEN, messages);
  const key = await chatSessionStorageKey(SHARE_TOKEN);
  expect(key).not.toContain(SHARE_TOKEN);
  expect(sessionStorage.getItem(key)).not.toContain(SHARE_TOKEN);
  const stored = await loadChatSession(SHARE_TOKEN);
  expect(stored).toHaveLength(12);
  expect(stored[0].id).toBe("2");
  expect(stored.at(-1)?.content).toBe("secret [private trip link removed]");
  expect(stored.at(-1)?.savedPlaceIds).toEqual(["place-tacos"]);
  expect(JSON.parse(sessionStorage.getItem(key) ?? "{}").version).toBe(2);
});

// @spec CHAT-DATA-004
it("discards version-1 ephemeral chat history", async () => {
  const key = (await chatSessionStorageKey(SHARE_TOKEN)).replace(
    "trip-chat:v2:",
    "trip-chat:v1:",
  );
  sessionStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      messages: [
        {
          id: "old",
          role: "assistant",
          content: "Old response",
          suggestions: [],
        },
      ],
    }),
  );

  expect(await loadChatSession(SHARE_TOKEN)).toEqual([]);
  expect(sessionStorage.getItem(key)).toBeNull();
});
