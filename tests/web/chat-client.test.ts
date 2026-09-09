import { expect, it } from "vitest";

import {
  chatSessionStorageKey,
  clearChatSession,
  loadChatSession,
  saveChatSession,
} from "@/lib/chat/session";
import { SHARE_TOKEN } from "./fixtures";

// @spec CHAT-DATA-004, CHAT-DATA-008, CHAT-DATA-012, SEC-DATA-007
it("stores at most twelve version-4 messages under a hash-derived session key", async () => {
  const messages = Array.from({ length: 14 }, (_, index) => ({
    id: String(index),
    role: (index % 2 ? "assistant" : "user") as "assistant" | "user",
    content: index === 13 ? `secret ${SHARE_TOKEN}` : `message ${index}`,
    savedPlaceIds: index === 13 ? ["place-tacos"] : [],
    suggestions: [],
    unresolvedPlaceNames: index === 13 ? ["A place needing clarification"] : [],
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
  expect(
    (stored.at(-1) as { unresolvedPlaceNames?: string[] } | undefined)
      ?.unresolvedPlaceNames,
  ).toEqual(["A place needing clarification"]);
  expect(JSON.parse(sessionStorage.getItem(key) ?? "{}").version).toBe(4);
});

// @spec CHAT-DATA-004
it("discards version-1 and version-2 ephemeral chat history", async () => {
  const currentKey = await chatSessionStorageKey(SHARE_TOKEN);
  const oldKeys = [1, 2].map((version) =>
    currentKey.replace("trip-chat:v3:", `trip-chat:v${version}:`),
  );
  for (const [index, key] of oldKeys.entries()) {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        version: index + 1,
        messages: [
          {
            id: "old",
            role: "assistant",
            content: "Old response",
            savedPlaceIds: [],
            suggestions: [],
          },
        ],
      }),
    );
  }

  expect(await loadChatSession(SHARE_TOKEN)).toEqual([]);
  for (const key of oldKeys) expect(sessionStorage.getItem(key)).toBeNull();
});

// @spec CHAT-DATA-009
it("clears only the selected trip's chat session", async () => {
  const otherToken = `${SHARE_TOKEN}-other`;
  await saveChatSession(SHARE_TOKEN, []);
  await saveChatSession(otherToken, []);

  await clearChatSession(SHARE_TOKEN);

  expect(
    sessionStorage.getItem(await chatSessionStorageKey(SHARE_TOKEN)),
  ).toBeNull();
  expect(
    sessionStorage.getItem(await chatSessionStorageKey(otherToken)),
  ).not.toBeNull();
});
