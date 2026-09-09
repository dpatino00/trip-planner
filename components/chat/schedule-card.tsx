import type { SavedPlace } from "@/lib/types";
import type { ScheduledItem } from "@/lib/chat/schema";

export type ScheduleStatus =
  "idle" | "adding" | "saved" | "duplicate" | "conflict" | "error";

interface ScheduleCardProps {
  place: SavedPlace;
  scheduledItem: ScheduledItem;
  status: ScheduleStatus;
  online: boolean;
  onConfirm: () => void;
}

// @spec CHAT-UI-018, CHAT-UI-019
export function ScheduleCard({
  place,
  scheduledItem,
  status,
  online,
  onConfirm,
}: ScheduleCardProps) {
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
      aria-label={`Schedule ${place.name}`}
    >
      <p className="eyebrow">PLAN CONFIRMATION</p>
      <h3>{place.name}</h3>
      <p>
        {scheduledItem.date} · {scheduledItem.startTime} ·{" "}
        {scheduledItem.durationMinutes} minutes
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
