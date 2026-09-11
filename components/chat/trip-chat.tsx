"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import type { SuggestionStatus } from "@/components/chat/suggestion-card";
import type { ScheduleStatus } from "@/components/chat/schedule-card";
import {
  clearChatSession,
  loadChatSession,
  saveChatSession,
  type ChatSessionMessage,
} from "@/lib/chat/session";
import {
  tripChatResponseV5Schema,
  type ScheduleCandidate,
} from "@/lib/chat/schema";
import { tripCopy } from "@/lib/ui/copy";
import type { SuggestedPlace, TripDocument } from "@/lib/types";

export interface AddSuggestionResult {
  status: "saved" | "duplicate" | "conflict" | "error";
}

export interface AddSuggestionsResult {
  statuses: AddSuggestionResult["status"][];
}

export interface ConfirmScheduleResult {
  status: "saved" | "duplicate" | "conflict" | "error";
}

interface TripChatProps {
  token: string;
  trip: TripDocument;
  online: boolean;
  onAddSuggestion: (suggestion: SuggestedPlace) => Promise<AddSuggestionResult>;
  onAddSuggestions?: (
    suggestions: SuggestedPlace[],
  ) => Promise<AddSuggestionsResult>;
  onViewSavedPlace: (placeId: string) => void;
  onTripVersion?: (version: number) => void | Promise<void>;
  onConfirmSchedule?: (
    candidate: ScheduleCandidate,
  ) => Promise<ConfirmScheduleResult>;
}

// @spec CHAT-DATA-008
export function buildChatHistory(messages: ChatSessionMessage[]) {
  let remainingCharacters = 8000;
  const newestFirst = messages
    .slice(-8)
    .reverse()
    .flatMap(({ role, content }) => {
      if (remainingCharacters === 0) return [];
      const boundedContent = content.slice(
        0,
        Math.min(2000, remainingCharacters),
      );
      remainingCharacters -= boundedContent.length;
      return boundedContent ? [{ role, content: boundedContent }] : [];
    });
  return newestFirst.reverse();
}

// @spec CHAT-DATA-004, CHAT-DATA-014, CHAT-API-001, CHAT-API-011, CHAT-API-012, CHAT-API-015, CHAT-UI-002, CHAT-UI-003, CHAT-UI-004, CHAT-UI-005, CHAT-UI-006, CHAT-UI-008, CHAT-UI-009, CHAT-UI-010, CHAT-UI-012, CHAT-UI-013, CHAT-UI-014, CHAT-UI-016, CHAT-UI-020, CHAT-UI-021, CHAT-UI-022, PWA-UI-007
export function TripChat({
  token,
  trip,
  online,
  onAddSuggestion,
  onAddSuggestions,
  onViewSavedPlace,
  onTripVersion,
  onConfirmSchedule,
}: TripChatProps) {
  const [messages, setMessages] = useState<ChatSessionMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [createCards, setCreateCards] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statuses, setStatuses] = useState<Record<string, SuggestionStatus>>(
    {},
  );
  const [scheduleStatuses, setScheduleStatuses] = useState<
    Record<string, ScheduleStatus>
  >({});
  const [hydrated, setHydrated] = useState(false);
  const skipNextSave = useRef(false);
  const placeById = useMemo(
    () => new Map(trip.places.map((place) => [place.id, place])),
    [trip.places],
  );

  useEffect(() => {
    let active = true;
    void loadChatSession(token).then((stored) => {
      if (active) {
        setMessages(stored);
        setHydrated(true);
      }
    });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    void saveChatSession(token, messages);
  }, [hydrated, messages, token]);

  async function submit() {
    const message = composer.trim();
    if (!message || loading || !online || !hydrated) return;
    const userMessage: ChatSessionMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      savedPlaceIds: [],
      suggestions: [],
      unresolvedPlaceNames: [],
      scheduleCandidate: null,
    };
    const history = buildChatHistory(messages);
    const requestCards = createCards;
    setMessages((current) => [...current, userMessage].slice(-12));
    setComposer("");
    setCreateCards(false);
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/trip/chat", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trip-chat-contract": "5",
        },
        body: JSON.stringify({
          message,
          history,
          ...(requestCards ? { createCards: true } : {}),
        }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const message = (payload as { error?: { message?: string } }).error
          ?.message;
        throw new Error(message ?? "Ask is unavailable");
      }
      const parsed = tripChatResponseV5Schema.parse(payload);
      setMessages((current) =>
        [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: parsed.message,
            savedPlaceIds: parsed.savedPlaceIds,
            suggestions: parsed.suggestions,
            unresolvedPlaceNames: parsed.unresolvedPlaceNames,
            scheduleCandidate: parsed.scheduleCandidate,
          },
        ].slice(-12),
      );
      if (parsed.tripVersion > trip.version) {
        void onTripVersion?.(parsed.tripVersion);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ask is unavailable");
    } finally {
      setLoading(false);
    }
  }

  async function addSuggestions(
    messageId: string,
    suggestions: SuggestedPlace[],
    indexes: number[],
  ) {
    setStatuses((current) => {
      const next = { ...current };
      for (const index of indexes) next[`${messageId}:${index}`] = "adding";
      return next;
    });
    try {
      const outcome = onAddSuggestions
        ? await onAddSuggestions(suggestions)
        : {
            statuses: await Promise.all(
              suggestions.map(
                async (suggestion) =>
                  (await onAddSuggestion(suggestion)).status,
              ),
            ),
          };
      setStatuses((current) => {
        const next = { ...current };
        for (const [position, index] of indexes.entries()) {
          next[`${messageId}:${index}`] = outcome.statuses[position] ?? "error";
        }
        return next;
      });
    } catch {
      setStatuses((current) => {
        const next = { ...current };
        for (const index of indexes) next[`${messageId}:${index}`] = "error";
        return next;
      });
    }
  }

  async function addSuggestion(
    messageId: string,
    suggestion: SuggestedPlace,
    index: number,
  ) {
    const key = `${messageId}:${index}`;
    setStatuses((current) => ({ ...current, [key]: "adding" }));
    const outcome = await onAddSuggestion(suggestion);
    setStatuses((current) => ({ ...current, [key]: outcome.status }));
  }

  async function confirmSchedule(
    messageId: string,
    candidate: ScheduleCandidate,
  ) {
    setScheduleStatuses((current) => ({ ...current, [messageId]: "adding" }));
    try {
      const outcome = onConfirmSchedule
        ? await onConfirmSchedule(candidate)
        : { status: "error" as const };
      setScheduleStatuses((current) => ({
        ...current,
        [messageId]: outcome.status,
      }));
    } catch {
      setScheduleStatuses((current) => ({ ...current, [messageId]: "error" }));
    }
  }

  function dismissSuggestion(messageId: string, index: number) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              suggestions: message.suggestions.filter(
                (_, candidateIndex) => candidateIndex !== index,
              ),
            }
          : message,
      ),
    );
  }

  async function startNewChat() {
    if (!hydrated || loading || messages.length === 0) return;
    if (
      !window.confirm(
        "Start a new chat? This clears Ask history in this browser tab only.",
      )
    ) {
      return;
    }
    await clearChatSession(token);
    skipNextSave.current = true;
    setMessages([]);
    setComposer("");
    setCreateCards(false);
    setError("");
    setStatuses({});
    setScheduleStatuses({});
  }

  return (
    <section className="trip-chat" aria-labelledby="ask-title">
      <div className="section-heading ask-heading">
        <div>
          <p className="eyebrow">{tripCopy.workspace.chat.eyebrow}</p>
          <h2 id="ask-title">Ask about {trip.destination.name}</h2>
          <p className="section-intro">{tripCopy.workspace.chat.intro}</p>
        </div>
        <button
          type="button"
          aria-label="New chat"
          disabled={!hydrated || loading || messages.length === 0}
          onClick={() => void startNewChat()}
        >
          New chat
        </button>
      </div>
      <div className="chat-thread" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <h3>{tripCopy.workspace.chat.emptyHeading}</h3>
            <p>{tripCopy.workspace.chat.emptyBody}</p>
          </div>
        ) : null}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            savedPlaces={message.savedPlaceIds.flatMap((id) => {
              const place = placeById.get(id);
              return place ? [place] : [];
            })}
            online={online}
            statusFor={(index) => statuses[`${message.id}:${index}`] ?? "idle"}
            onAdd={(suggestion, index) =>
              void addSuggestion(message.id, suggestion, index)
            }
            onDismiss={(index) => dismissSuggestion(message.id, index)}
            onAddAll={(suggestions, indexes) =>
              void addSuggestions(message.id, suggestions, indexes)
            }
            onViewSavedPlace={onViewSavedPlace}
            scheduledPlace={
              message.scheduleCandidate?.savedPlaceId
                ? (placeById.get(message.scheduleCandidate.savedPlaceId) ??
                  null)
                : null
            }
            scheduleStatus={scheduleStatuses[message.id] ?? "idle"}
            onConfirmSchedule={(candidate) =>
              void confirmSchedule(message.id, candidate)
            }
          />
        ))}
        {loading ? (
          <p className="chat-thinking" role="status">
            Thinking through your trip…
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {!online ? (
        <p className="offline-banner">
          Connect to ask or add a suggestion. Your messages stay here.
        </p>
      ) : null}
      <div className="chat-composer">
        <label className="chat-card-toggle">
          <input
            type="checkbox"
            checked={createCards}
            disabled={!online || !hydrated || loading}
            onChange={(event) => setCreateCards(event.target.checked)}
          />
          Create cards
        </label>
        <label htmlFor="trip-chat-composer" className="visually-hidden">
          Ask about this trip
        </label>
        <textarea
          id="trip-chat-composer"
          aria-label="Ask about this trip"
          value={composer}
          maxLength={8000}
          disabled={!online || !hydrated}
          placeholder="What would fit a relaxed morning?"
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          className="primary"
          disabled={!online || !hydrated || loading || !composer.trim()}
          onClick={() => void submit()}
        >
          Send
        </button>
      </div>
    </section>
  );
}
