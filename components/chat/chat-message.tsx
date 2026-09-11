import type { ChatSessionMessage } from "@/lib/chat/session";
import type { SavedPlace, SuggestedPlace } from "@/lib/types";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { SavedPlaceCard } from "@/components/chat/saved-place-card";
import {
  SuggestionCard,
  type SuggestionStatus,
} from "@/components/chat/suggestion-card";
import {
  ScheduleCard,
  type ScheduleStatus,
} from "@/components/chat/schedule-card";
import type { ScheduleCandidate } from "@/lib/chat/schema";

interface ChatMessageProps {
  message: ChatSessionMessage;
  savedPlaces: SavedPlace[];
  online: boolean;
  statusFor: (index: number) => SuggestionStatus;
  onAdd: (suggestion: SuggestedPlace, index: number) => void;
  onAddAll: (suggestions: SuggestedPlace[], indexes: number[]) => void;
  onDismiss: (index: number) => void;
  onViewSavedPlace: (placeId: string) => void;
  scheduledPlace: SavedPlace | null;
  scheduleStatus: ScheduleStatus;
  onConfirmSchedule: (candidate: ScheduleCandidate) => void;
}

// @spec CHAT-UI-002, CHAT-UI-006, CHAT-UI-012, CHAT-UI-013, CHAT-UI-014
export function ChatMessage({
  message,
  savedPlaces,
  online,
  statusFor,
  onAdd,
  onAddAll,
  onDismiss,
  onViewSavedPlace,
  scheduledPlace,
  scheduleStatus,
  onConfirmSchedule,
}: ChatMessageProps) {
  const addableSuggestions = message.suggestions.flatMap(
    (suggestion, index) => {
      const status = statusFor(index);
      return status === "saved" || status === "duplicate"
        ? []
        : [{ suggestion, index }];
    },
  );
  return (
    <div className={`chat-message ${message.role}`}>
      <p className="chat-role">
        {message.role === "user" ? "You" : "Trip companion"}
      </p>
      {message.role === "assistant" ? (
        <AssistantMessage content={message.content} />
      ) : (
        <p>{message.content}</p>
      )}
      {savedPlaces.length > 0 ? (
        <div className="saved-match-list">
          {savedPlaces.map((place) => (
            <SavedPlaceCard
              key={place.id}
              place={place}
              online={online}
              onViewInIdeas={() => onViewSavedPlace(place.id)}
            />
          ))}
        </div>
      ) : null}
      {message.suggestions.length > 0 ? (
        <div className="suggestion-list">
          {addableSuggestions.length > 1 ? (
            <button
              className="primary add-all-suggestions"
              disabled={
                !online ||
                addableSuggestions.some(
                  ({ index }) => statusFor(index) === "adding",
                )
              }
              onClick={() =>
                onAddAll(
                  addableSuggestions.map(({ suggestion }) => suggestion),
                  addableSuggestions.map(({ index }) => index),
                )
              }
            >
              Add all new
            </button>
          ) : null}
          {message.suggestions.map((suggestion, index) => (
            <SuggestionCard
              key={`${suggestion.name}-${suggestion.locality ?? ""}-${index}`}
              suggestion={suggestion}
              status={statusFor(index)}
              online={online}
              onAdd={() => onAdd(suggestion, index)}
              onDismiss={() => onDismiss(index)}
            />
          ))}
        </div>
      ) : null}
      {message.scheduleCandidate &&
      (scheduledPlace || message.scheduleCandidate.suggestion) ? (
        <ScheduleCard
          place={scheduledPlace}
          candidate={message.scheduleCandidate}
          status={scheduleStatus}
          online={online}
          onConfirm={() => onConfirmSchedule(message.scheduleCandidate!)}
        />
      ) : null}
      {message.unresolvedPlaceNames.length > 0 ? (
        <div
          className="unresolved-place-list"
          aria-label="Places needing clarification"
        >
          <p className="why">Needs clarification</p>
          <ul>
            {message.unresolvedPlaceNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
