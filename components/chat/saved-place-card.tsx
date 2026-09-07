import { createPlaceMapLinks } from "@/lib/places/links";
import type { SavedPlace } from "@/lib/types";

interface SavedPlaceCardProps {
  place: SavedPlace;
  online: boolean;
  onViewInIdeas: () => void;
}

// @spec CHAT-UI-006, CHAT-UI-008, CHAT-UI-009
export function SavedPlaceCard({
  place,
  online,
  onViewInIdeas,
}: SavedPlaceCardProps) {
  const maps = createPlaceMapLinks(place);
  const offlineLabel = online ? "" : " — requires connection";

  return (
    <article
      aria-label={place.name}
      className="saved-match-card"
      data-testid="saved-match-card"
    >
      <p className="eyebrow">Already in your Ideas</p>
      <h3>{place.name}</h3>
      {place.locality ? (
        <p className="suggestion-locality">{place.locality}</p>
      ) : null}
      {place.summary ? <p>{place.summary}</p> : null}
      {place.tags.length > 0 ? (
        <div className="chips">
          {place.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      <div className="card-actions">
        {place.sourceUrl ? (
          <a href={place.sourceUrl} target="_blank" rel="noopener noreferrer">
            Visit source{offlineLabel}
          </a>
        ) : null}
        <a href={maps.apple} target="_blank" rel="noopener noreferrer">
          Apple Maps{offlineLabel}
        </a>
        <a href={maps.google} target="_blank" rel="noopener noreferrer">
          Google Maps{offlineLabel}
        </a>
        <a href={maps.directions} target="_blank" rel="noopener noreferrer">
          Directions{offlineLabel}
        </a>
        <button onClick={onViewInIdeas}>View {place.name} in Ideas</button>
      </div>
    </article>
  );
}
