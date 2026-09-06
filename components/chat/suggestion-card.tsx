import type { SuggestedPlace } from "@/lib/types";

export type SuggestionStatus =
  "idle" | "adding" | "saved" | "duplicate" | "conflict" | "error";

interface SuggestionCardProps {
  suggestion: SuggestedPlace;
  status: SuggestionStatus;
  online: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}

// @spec CHAT-UI-004, CHAT-UI-005, CHAT-UI-006
export function SuggestionCard({
  suggestion,
  status,
  online,
  onAdd,
  onDismiss,
}: SuggestionCardProps) {
  const saved = status === "saved" || status === "duplicate";
  const label =
    status === "saved"
      ? "Saved to Ideas"
      : status === "duplicate"
        ? "Already in Ideas"
        : status === "conflict"
          ? "Trip changed twice—retry when ready"
          : status === "error"
            ? "Could not save this suggestion"
            : "";
  return (
    <article className="suggestion-card" aria-label={suggestion.name}>
      <p className="eyebrow">PLACE SUGGESTION · DETAILS UNVERIFIED</p>
      <h3>{suggestion.name}</h3>
      {suggestion.locality ? (
        <p className="suggestion-locality">{suggestion.locality}</p>
      ) : null}
      {suggestion.summary ? <p>{suggestion.summary}</p> : null}
      <div className="chips">
        {suggestion.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      {label ? (
        <p className={status === "error" ? "error" : "verified"}>{label}</p>
      ) : null}
      <div className="card-actions">
        <button
          className="primary"
          disabled={!online || status === "adding" || saved}
          onClick={onAdd}
          aria-label={`${status === "conflict" ? "Retry adding" : "Add"} ${suggestion.name} to trip`}
        >
          {status === "adding"
            ? "Adding…"
            : status === "conflict"
              ? "Retry"
              : "Add to trip"}
        </button>
        <button onClick={onDismiss} aria-label={`Dismiss ${suggestion.name}`}>
          Dismiss
        </button>
      </div>
    </article>
  );
}
