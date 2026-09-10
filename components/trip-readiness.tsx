import type { TripReadiness as Readiness } from "@/lib/trips/readiness";

interface TripReadinessProps {
  readiness: Readiness;
  onViewIdeas: () => void;
}

interface ReadinessItem {
  count: number;
  label: string;
  guidance: string;
}

export function TripReadiness({ readiness, onViewIdeas }: TripReadinessProps) {
  const items: ReadinessItem[] = [
    {
      count: readiness.emptyItineraryDays,
      label: "empty itinerary days",
      guidance: "Add a stop to each day you want to plan.",
    },
    {
      count: readiness.tentativeStops,
      label: "tentative stops",
      guidance: "Review the plan below when you are ready to confirm them.",
    },
    {
      count: readiness.tentativeReservationStops,
      label: "tentative stops to reserve",
      guidance:
        "Check directly with the venue before treating a reservation as set.",
    },
  ];
  const followUps = items.filter((item) => item.count > 0);
  const isReady =
    followUps.length === 0 && readiness.unscheduledFavoriteIdeas === 0;

  return (
    <section className="trip-readiness" aria-labelledby="trip-readiness-title">
      <p className="eyebrow">Trip readiness</p>
      <h3 id="trip-readiness-title">
        {isReady ? "Your plan is looking settled" : "A few things to review"}
      </h3>
      {isReady ? (
        <p className="snapshot-note">
          Every day has a stop and your planned stops are confirmed.
        </p>
      ) : (
        <ul className="readiness-list">
          {followUps.map((item) => (
            <li key={item.label}>
              <strong>{item.count}</strong> {item.label}. {item.guidance}
            </li>
          ))}
          {readiness.unscheduledFavoriteIdeas > 0 && (
            <li>
              <strong>{readiness.unscheduledFavoriteIdeas}</strong> unscheduled
              favorite{" "}
              {readiness.unscheduledFavoriteIdeas === 1 ? "idea" : "ideas"}.{" "}
              <button className="text-button" onClick={onViewIdeas}>
                Review Ideas
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
