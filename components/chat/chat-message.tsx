import type { ChatSessionMessage } from "@/lib/chat/session";
import type { SavedPlace, SuggestedPlace } from "@/lib/types";
import { SavedPlaceCard } from "@/components/chat/saved-place-card";
import {
  SuggestionCard,
  type SuggestionStatus,
} from "@/components/chat/suggestion-card";

interface ChatMessageProps {
  message: ChatSessionMessage;
  savedPlaces: SavedPlace[];
  online: boolean;
  statusFor: (index: number) => SuggestionStatus;
  onAdd: (suggestion: SuggestedPlace, index: number) => void;
  onDismiss: (index: number) => void;
  onViewSavedPlace: (placeId: string) => void;
}

export function ChatMessage({
  message,
  savedPlaces,
  online,
  statusFor,
  onAdd,
  onDismiss,
  onViewSavedPlace,
}: ChatMessageProps) {
  return (
    <div className={`chat-message ${message.role}`}>
      <p className="chat-role">
        {message.role === "user" ? "You" : "Trip companion"}
      </p>
      <p>{message.content}</p>
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
    </div>
  );
}
