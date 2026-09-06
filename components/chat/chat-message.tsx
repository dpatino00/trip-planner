import type { ChatSessionMessage } from "@/lib/chat/session";
import type { SuggestedPlace } from "@/lib/types";
import {
  SuggestionCard,
  type SuggestionStatus,
} from "@/components/chat/suggestion-card";

interface ChatMessageProps {
  message: ChatSessionMessage;
  online: boolean;
  statusFor: (index: number) => SuggestionStatus;
  onAdd: (suggestion: SuggestedPlace, index: number) => void;
  onDismiss: (index: number) => void;
}

export function ChatMessage({
  message,
  online,
  statusFor,
  onAdd,
  onDismiss,
}: ChatMessageProps) {
  return (
    <div className={`chat-message ${message.role}`}>
      <p className="chat-role">
        {message.role === "user" ? "You" : "Trip companion"}
      </p>
      <p>{message.content}</p>
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
