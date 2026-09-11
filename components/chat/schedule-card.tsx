import type { SavedPlace } from "@/lib/types";
import type { ScheduleCandidate } from "@/lib/chat/schema";

export type ScheduleStatus =
  "idle" | "adding" | "saved" | "duplicate" | "conflict" | "error";

interface ScheduleCardProps {
  place: SavedPlace | null;
  candidate: ScheduleCandidate;
  status: ScheduleStatus;
  online: boolean;
  onConfirm: () => void;
}

// @spec CHAT-UI-018, CHAT-UI-019, CHAT-UI-020, CHAT-UI-021, CHAT-UI-022
export function ScheduleCard({
  place,
  candidate,
  status,
  online,
  onConfirm,
}: ScheduleCardProps) {
  const displayPlace = place ?? candidate.suggestion;
  if (!displayPlace) return null;
  const complete = status === "saved";
  const label =
    status === "saved"
      ? "Added to plan"
      : status === "conflict"
        ? "Trip changed twice—retry when ready"
        : status === "error"
          ? "Could not add this stop"
          : "";
  return (
    <article
      className="suggestion-card schedule-card"
      aria-label={`Schedule ${displayPlace.name}`}
    >
      <p className="eyebrow">PLAN CONFIRMATION</p>
      <h3>{displayPlace.name}</h3>
      {candidate.suggestion ? (
        <p className="verified">New trip idea · details not verified</p>
      ) : null}
      <p>
        {candidate.date} · {candidate.startTime} · {candidate.durationMinutes}{" "}
        minutes
      </p>
      {label ? (
        <p className={status === "error" ? "error" : "verified"}>{label}</p>
      ) : null}
      <div className="card-actions">
        <button
          className="primary"
          disabled={!online || status === "adding" || complete}
          onClick={onConfirm}
        >
          {status === "adding"
            ? "Adding…"
            : status === "conflict"
              ? "Retry"
              : "Confirm & add to plan"}
        </button>
      </div>
    </article>
  );
}
