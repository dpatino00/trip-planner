"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { TripChat } from "@/components/chat/trip-chat";
import {
  loadTripSnapshot,
  removeTripSnapshot,
  saveTripSnapshot,
} from "@/lib/offline/trip-snapshot";
import { registerServiceWorker } from "@/lib/offline/register-service-worker";
import { createPlaceMapLinks } from "@/lib/places/links";
import { rankPlaces } from "@/lib/recommendations/scoring";
import type {
  ConditionsEnvelope,
  SavedPlace,
  SuggestedPlace,
  TripDocument,
  TripApiMutation,
  TripMutation,
} from "@/lib/types";
import {
  createConditionRefreshPolicy,
  createTripRefreshPolicy,
  mutateTripWithRetry,
} from "@/lib/trips/client";

type View = "today" | "ideas" | "plan" | "ask";
const tokenPattern = /^[A-Za-z0-9_-]{22}$/;
const reasonLabels: Record<string, string> = {
  "preference-match": "Matches your interests",
  "conditions-fit": "Fits the day",
  "time-fit": "Good for this time",
  "distance-fit": "Convenient distance",
};

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (
    let time = Date.parse(`${start}T00:00:00Z`);
    time <= Date.parse(`${end}T00:00:00Z`);
    time += 86_400_000
  ) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function normalizedPlaceValue(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function matchesSuggestedPlace(place: SavedPlace, suggestion: SuggestedPlace) {
  return (
    normalizedPlaceValue(place.name) ===
      normalizedPlaceValue(suggestion.name) &&
    normalizedPlaceValue(place.locality) ===
      normalizedPlaceValue(suggestion.locality)
  );
}
function emptyConditions(target: string): ConditionsEnvelope {
  return {
    status: "unavailable",
    requestedFor: target,
    fetchedAt: "",
    expiresAt: "",
    coordinates: null,
    timeZone: null,
    temperatureF: null,
    apparentTemperatureF: null,
    precipitationProbability: null,
    windMph: null,
    weatherCode: null,
    uvIndex: null,
    airQualityIndex: null,
    isDay: null,
    sunrise: null,
    sunset: null,
    marine: null,
    source: "Open-Meteo",
  };
}

interface PlaceCardProps {
  place: SavedPlace;
  favorite: boolean;
  disabled: boolean;
  recommendation?: ReturnType<typeof rankPlaces>[number];
  onFavorite: () => void;
  onAdd: () => void;
}

// @spec PLC-UI-001, PLC-UI-002, PLC-UI-003, PLC-UI-004, PLC-UI-005
function PlaceCard({
  place,
  favorite,
  disabled,
  recommendation,
  onFavorite,
  onAdd,
}: PlaceCardProps) {
  const maps = createPlaceMapLinks(place);
  return (
    <article
      aria-label={place.name}
      className="place-card"
      data-testid={recommendation ? "recommendation-card" : undefined}
    >
      <div className="place-card-body">
        <div className="card-heading">
          <div>
            <p className="eyebrow">{place.locality ?? "Saved for this trip"}</p>
            <h3>{place.name}</h3>
          </div>
          <span className="cost">
            {place.costLevel === null
              ? "Cost unknown"
              : "$".repeat(place.costLevel) || "Free"}
          </span>
        </div>
        {place.summary && <p>{place.summary}</p>}
        <div className="chips">
          {place.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        {place.origin === "chatgpt" && (
          <p className="verified">Added by ChatGPT · details not verified</p>
        )}
        {recommendation && (
          <>
            <p className="why">Why it fits</p>
            <div className="chips">
              {recommendation.reasons.map((reason) => (
                <span data-testid="reason-chip" key={reason}>
                  {reasonLabels[reason] ?? reason}
                </span>
              ))}
            </div>
            {recommendation.cautions.length > 0 && (
              <p className="caution">
                Keep in mind:{" "}
                {recommendation.cautions.join(", ").replaceAll("-", " ")}
              </p>
            )}
          </>
        )}
        <div className="card-actions">
          <button
            disabled={disabled}
            onClick={onFavorite}
            aria-label={
              favorite
                ? `Remove ${place.name} from saved`
                : `Save ${place.name}`
            }
          >
            {favorite ? "Saved" : "Save"}
          </button>
          <button
            disabled={disabled}
            onClick={onAdd}
            aria-label={`Add ${place.name} to plan`}
          >
            Add to plan
          </button>
          {place.sourceUrl && (
            <a href={place.sourceUrl} target="_blank" rel="noopener noreferrer">
              Visit source
            </a>
          )}
          <a href={maps.apple} target="_blank" rel="noopener noreferrer">
            Apple Maps
          </a>
          <a href={maps.google} target="_blank" rel="noopener noreferrer">
            Google Maps{disabled ? " — requires connection" : ""}
          </a>
          <a href={maps.directions} target="_blank" rel="noopener noreferrer">
            Directions{disabled ? " — requires connection" : ""}
          </a>
        </div>
      </div>
    </article>
  );
}

// @spec TRIP-NAV-001, TRIP-NAV-002, TRIP-NAV-003, APP-UI-001, APP-UI-002
export function TripWorkspace() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [fragmentReady, setFragmentReady] = useState(false);
  const [view, setView] = useState<View>("today");
  const [online, setOnline] = useState(true);
  const [cachedTrip, setCachedTrip] = useState<TripDocument | null>(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [selectedTime, setSelectedTime] = useState("10:00");
  const [deviceCoordinates, setDeviceCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [chatGptOpen, setChatGptOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<SavedPlace | null>(null);
  const [planDate, setPlanDate] = useState("");
  const [search, setSearch] = useState("");
  const [interest, setInterest] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    let active = true;
    const raw = window.location.hash.slice(1);
    const found = tokenPattern.test(raw) ? raw : null;
    void (async () => {
      const snapshot = found ? await loadTripSnapshot(found) : null;
      if (active && snapshot) {
        setCachedTrip(snapshot.trip as TripDocument);
      }
      if (
        !snapshot &&
        navigator.onLine &&
        !navigator.serviceWorker.controller
      ) {
        await Promise.race([
          registerServiceWorker(() => dirtyRef.current).catch(() => undefined),
          new Promise<void>((resolve) => window.setTimeout(resolve, 1000)),
        ]);
      } else if (navigator.onLine) {
        void registerServiceWorker(() => dirtyRef.current).catch(
          () => undefined,
        );
      }
      if (active) {
        let reachable = navigator.onLine;
        try {
          await fetch(`/api/connectivity-probe?at=${Date.now()}`, {
            method: "HEAD",
            cache: "no-store",
          });
          reachable = true;
        } catch {
          reachable = false;
        }
        const params = new URLSearchParams(window.location.search);
        const initialView = params.get("view");
        if (
          initialView === "ideas" ||
          initialView === "plan" ||
          initialView === "ask"
        ) {
          setView(initialView);
        }
        setSearch(params.get("search") ?? "");
        setInterest(params.get("interest") ?? "");
        setToken(found);
        setOnline(reachable);
        setFragmentReady(true);
      }
    })();
    const connect = () => setOnline(true);
    const disconnect = () => setOnline(false);
    window.addEventListener("online", connect);
    window.addEventListener("offline", disconnect);
    return () => {
      active = false;
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", disconnect);
    };
  }, []);

  const tripState = useSWR<{ trip: TripDocument; cached?: boolean }>(
    token && online ? ["/api/trip", token] : null,
    async () => {
      try {
        const result = await fetch("/api/trip", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (result.status === 404) {
          await removeTripSnapshot(token!);
          throw Object.assign(new Error("Trip not found"), { status: 404 });
        }
        if (!result.ok) throw new Error("Trip could not be loaded");
        const payload = (await result.json()) as { trip: TripDocument };
        await saveTripSnapshot(token!, payload.trip);
        setCachedTrip(payload.trip);
        return payload;
      } catch (cause) {
        if ((cause as { status?: number }).status === 404) throw cause;
        const snapshot = await loadTripSnapshot(token!);
        if (snapshot) {
          return { trip: snapshot.trip as TripDocument, cached: true };
        }
        throw cause;
      }
    },
    createTripRefreshPolicy(),
  );
  const trip = tripState.data?.trip ?? cachedTrip;
  const marineNeeded =
    trip?.places.some(
      (place) => place.profile === "coastal" || place.waterContact,
    ) ?? false;
  const conditionParams = new URLSearchParams({
    at: `${selectedDate}T${selectedTime}:00Z`,
    marine: String(marineNeeded),
  });
  if (trip?.destination.coordinates) {
    conditionParams.set(
      "latitude",
      String(trip.destination.coordinates.latitude),
    );
    conditionParams.set(
      "longitude",
      String(trip.destination.coordinates.longitude),
    );
  }
  const conditionsState = useSWR<ConditionsEnvelope>(
    token && trip ? `/api/conditions?${conditionParams.toString()}` : null,
    async (url: string) => {
      const result = await fetch(url);
      if (!result.ok) throw new Error("Conditions unavailable");
      return result.json();
    },
    createConditionRefreshPolicy(),
  );
  const conditions = useMemo<ConditionsEnvelope>(() => {
    const fallback = emptyConditions(`${selectedDate}T${selectedTime}:00Z`);
    return conditionsState.data
      ? {
          ...fallback,
          ...conditionsState.data,
          marine: conditionsState.data.marine
            ? Object.assign(
                {
                  status: "unavailable" as const,
                  seaSurfaceTemperatureF: null,
                  waveHeightFt: null,
                  wavePeriodSeconds: null,
                  disclaimer:
                    "Advisory model data; not suitable for navigation.",
                },
                conditionsState.data.marine,
              )
            : null,
        }
      : fallback;
  }, [conditionsState.data, selectedDate, selectedTime]);
  const isOffline =
    !online ||
    Boolean(tripState.data?.cached) ||
    Boolean(cachedTrip && !tripState.data);
  const origin = deviceCoordinates ?? trip?.homeBase?.coordinates ?? null;
  const recommendations = useMemo(
    () =>
      trip
        ? rankPlaces(
            trip.places,
            trip,
            conditions,
            new Date(conditions.requestedFor),
            origin,
          )
        : [],
    [trip, conditions, origin],
  );
  const placeById = useMemo(
    () => new Map((trip?.places ?? []).map((place) => [place.id, place])),
    [trip],
  );

  function changeView(next: View) {
    setView(next);
    const params = new URLSearchParams(window.location.search);
    params.set("view", next);
    history.pushState(null, "", `?${params.toString()}#${token}`);
  }
  function setIdeaFilters(nextSearch: string, nextInterest: string) {
    setSearch(nextSearch);
    setInterest(nextInterest);
    const params = new URLSearchParams(window.location.search);
    params.set("view", "ideas");
    if (nextSearch) params.set("search", nextSearch);
    else params.delete("search");
    if (nextInterest) params.set("interest", nextInterest);
    else params.delete("interest");
    history.replaceState(null, "", `?${params.toString()}#${token}`);
  }

  // @spec CHAT-UI-009
  function viewSavedPlace(placeId: string) {
    const place = placeById.get(placeId);
    if (!place) return;
    setView("ideas");
    setSearch(place.name);
    setInterest("");
    const params = new URLSearchParams(window.location.search);
    params.set("view", "ideas");
    params.set("search", place.name);
    params.delete("interest");
    history.pushState(null, "", `?${params.toString()}#${token}`);
  }

  async function performMutation(mutation: TripApiMutation, draft?: unknown) {
    if (!trip || !token || isOffline) return { status: "error" as const };
    setMutationError("");
    setDirty(true);
    try {
      const outcome = await mutateTripWithRetry({
        trip,
        mutationId: crypto.randomUUID(),
        mutation,
        draft,
        request: async (body) => {
          const response = await fetch("/api/trip", {
            method: "PATCH",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          });
          const payload = await response.json();
          if (!response.ok && response.status !== 409) {
            throw new Error(payload.error?.message ?? "Change failed");
          }
          return {
            status: response.status,
            trip: payload.trip,
            duplicate: payload.duplicate,
          };
        },
      });
      if (outcome.status === "conflict") {
        setMutationError("Trip changed again. Review and retry your change.");
        await tripState.mutate({ trip: outcome.trip }, false);
        setCachedTrip(outcome.trip);
        await saveTripSnapshot(token, outcome.trip);
        return { status: "conflict" as const };
      }
      await tripState.mutate({ trip: outcome.trip }, false);
      setCachedTrip(outcome.trip);
      await saveTripSnapshot(token, outcome.trip);
      return {
        status: outcome.duplicate ? ("duplicate" as const) : ("saved" as const),
      };
    } catch (cause) {
      setMutationError(
        cause instanceof Error ? cause.message : "Could not save that change",
      );
      return { status: "error" as const };
    } finally {
      setDirty(false);
    }
  }

  // @spec CHAT-API-011, CHAT-UI-010
  async function refreshTripAfterAsk(tripVersion: number) {
    if (!trip || tripVersion <= trip.version) return;
    await tripState.mutate();
  }

  async function commit(mutation: TripMutation) {
    await performMutation(mutation);
  }

  function addSuggestedPlace(suggestion: SuggestedPlace) {
    return (async () => {
      const outcome = await performMutation(
        { type: "add-suggested-place", suggestion },
        suggestion,
      );
      if (outcome.status !== "error" || !token) return outcome;

      // A timed-out or interrupted response can arrive after the repository
      // committed the mutation. Reconcile once before showing a false error.
      try {
        const refreshed = await tripState.mutate();
        const refreshedTrip = refreshed?.trip;
        if (
          refreshedTrip?.places.some((place) =>
            matchesSuggestedPlace(place, suggestion),
          )
        ) {
          setCachedTrip(refreshedTrip);
          await saveTripSnapshot(token, refreshedTrip);
          setMutationError("");
          return { status: "saved" as const };
        }
      } catch {
        // Preserve the original mutation error when reconciliation is also unavailable.
      }
      return outcome;
    })();
  }

  async function shareTrip() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: trip?.title, url });
        setShareMessage("Share sheet opened");
      } else {
        await navigator.clipboard.writeText(url);
        setShareMessage("Link copied");
      }
    } catch {
      setShareMessage("Share cancelled");
    }
  }
  async function copyForChatGpt() {
    await navigator.clipboard.writeText(window.location.href);
    setShareMessage("Link copied");
    setChatGptOpen(false);
  }
  function useLocation() {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setDeviceCoordinates({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        setLocationMessage("Ranking from your location");
      },
      () => setLocationMessage("Location unavailable; using your home base"),
      { timeout: 5000 },
    );
  }
  async function deleteTrip() {
    if (!token || deleteConfirmation !== "DELETE") return;
    const result = await fetch("/api/trip", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
    if (result.ok) {
      await removeTripSnapshot(token);
      sessionStorage.setItem("trip-deleted", "1");
      router.push("/");
    }
  }
  useEffect(() => {
    if (deleteOpen) deleteInputRef.current?.focus();
  }, [deleteOpen]);

  if (!fragmentReady)
    return <main className="loading">Loading your trip…</main>;
  if (!token) {
    return (
      <main className="recovery">
        <h1>Open your private trip link</h1>
        <button
          onClick={async () => {
            const value = await navigator.clipboard.readText();
            const parsed = new URL(value);
            if (tokenPattern.test(parsed.hash.slice(1))) {
              router.push(`${parsed.pathname}${parsed.search}${parsed.hash}`);
            }
          }}
        >
          Paste trip link
        </button>
        <Link href="/">Create a new trip</Link>
      </main>
    );
  }
  if ((tripState.error as { status?: number } | undefined)?.status === 404) {
    return (
      <main className="recovery">
        <h1>Trip not found or expired</h1>
        <Link href="/">Create a new trip</Link>
      </main>
    );
  }
  if (!trip) return <main className="loading">Unpacking your trip…</main>;

  const tripDates = datesBetween(trip.startDate, trip.endDate);
  const today = conditions.requestedFor.slice(0, 10);
  const visiblePlaces = trip.places.filter((place) => {
    const query = normalizeSearch(
      [place.name, place.locality, place.summary, ...place.tags].join(" "),
    );
    return (
      query.includes(normalizeSearch(search)) &&
      (!interest || place.interests.includes(interest as never))
    );
  });
  const pendingProposal = trip.proposals.find(
    (proposal) => proposal.status === "pending",
  );

  return (
    <div className="workspace">
      <div className="trip-nav-wrap">
        <nav className="trip-nav" aria-label="Trip">
          <span className="trip-nav-mark" aria-hidden="true">
            ✦
          </span>
          {(["today", "ideas", "plan", "ask"] as View[]).map((item) => (
            <a
              href={`?view=${item}#${token}`}
              key={item}
              aria-current={view === item ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                changeView(item);
              }}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </a>
          ))}
        </nav>
      </div>
      <main className="trip-main">
        <header className="trip-header">
          <div className="trip-header-copy">
            <p className="trip-kicker">
              <span className="private-pill">Private shared plan</span>
              {trip.destination.name}
            </p>
            <h1>{trip.title}</h1>
            <p className="trip-dates">
              {dateLabel(trip.startDate)} — {dateLabel(trip.endDate)}
            </p>
            <div className="trip-vibes">
              {trip.preferences.interests.slice(0, 4).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
          <div className="header-actions">
            <button className="share-button primary" onClick={shareTrip}>
              Share trip
            </button>
            <button onClick={() => setChatGptOpen(true)}>
              Copy link for ChatGPT
            </button>
            <button
              className="icon-button"
              aria-label="Trip settings"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              •••
            </button>
          </div>
          <span className="postcard-stamp" aria-hidden="true">
            MADE
            <strong>TOGETHER</strong>
          </span>
        </header>
        {isOffline && (
          <p className="offline-banner">
            Offline · showing stale saved details
          </p>
        )}
        {shareMessage && (
          <p className="toast" role="status">
            {shareMessage}
          </p>
        )}
        {mutationError && (
          <p className="error" role="alert">
            {mutationError}
          </p>
        )}
        {settingsOpen && (
          <section className="settings-panel" aria-label="Trip settings panel">
            <h2>Trip settings</h2>
            <p>
              Anyone with this private link can view, edit, and delete the trip.
            </p>
            <button
              className="danger"
              ref={deleteTriggerRef}
              onClick={() => setDeleteOpen(true)}
            >
              Delete trip
            </button>
          </section>
        )}

        {view === "today" && (
          <>
            <div className="today-title clubhouse-title">
              <div>
                <p className="eyebrow">THE DAILY PULSE</p>
                <h2>What feels right today?</h2>
              </div>
              <button className="location-button" onClick={useLocation}>
                Use my location
              </button>
            </div>
            {locationMessage && <p role="status">{locationMessage}</p>}
            <div className="pulse-grid">
              <section className="condition-card" aria-label="Conditions">
                <div className="condition-card-topline">
                  <span className="live-dot">{conditions.status}</span>
                  <span>{conditions.timeZone ?? trip.destination.name}</span>
                </div>
                {conditions.status === "unavailable" ? (
                  <div className="condition-unavailable">
                    <strong>Conditions taking a breather</strong>
                    <p>
                      {conditions.reason === "forecast-out-of-range"
                        ? "Refresh closer to that date."
                        : "Your saved places and plan are still here."}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="condition-hero">
                      <strong>
                        {Math.round(conditions.temperatureF ?? 0)}°
                      </strong>
                      <div>
                        <h3>A fresh page for the day</h3>
                        <p>
                          {conditions.precipitationProbability ?? "—"}% rain
                        </p>
                      </div>
                    </div>
                    <div className="condition-grid">
                      <span>
                        <small>Wind</small>
                        <strong>
                          {Math.round(conditions.windMph ?? 0)} mph
                        </strong>
                      </span>
                      <span>
                        <small>Air</small>
                        <strong>
                          AQI {conditions.airQualityIndex?.value ?? "—"}
                        </strong>
                      </span>
                      <span>
                        <small>Sun</small>
                        <strong>UV {conditions.uvIndex ?? "—"}</strong>
                      </span>
                    </div>
                  </>
                )}
                {conditions.marine?.status === "live" && (
                  <p>
                    {Math.round(conditions.marine.seaSurfaceTemperatureF ?? 0)}°
                    water · {conditions.marine.waveHeightFt?.toFixed(1)} ft ·{" "}
                    {conditions.marine.wavePeriodSeconds} sec
                  </p>
                )}
                {conditions.marine && (
                  <p className="advisory">
                    Coastal-model data is advisory and not suitable for
                    navigation.
                  </p>
                )}
                <div className="condition-time">
                  <label>
                    Recommendation date
                    <input
                      aria-label="Recommendation date"
                      type="date"
                      value={selectedDate}
                      onChange={(event) => setSelectedDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Recommendation time
                    <input
                      aria-label="Recommendation time"
                      type="time"
                      value={selectedTime}
                      onChange={(event) => setSelectedTime(event.target.value)}
                    />
                  </label>
                </div>
              </section>
              <aside className="trip-snapshot">
                <p className="eyebrow">YOUR LITTLE UNIVERSE</p>
                <h3>A plan that gets better as you talk.</h3>
                <div className="snapshot-numbers">
                  <div>
                    <strong>{trip.places.length}</strong>
                    <span>saved ideas</span>
                  </div>
                  <div>
                    <strong>{trip.itinerary.length}</strong>
                    <span>plans so far</span>
                  </div>
                </div>
              </aside>
            </div>
            <div className="section-heading">
              <div>
                <p className="eyebrow">SIX GOOD DIRECTIONS</p>
                <h2>Places matching the shape of your day</h2>
              </div>
            </div>
            {conditions.status === "unavailable" && (
              <p>
                Ranking by your preferences; live conditions are unavailable.
              </p>
            )}
            <div className="card-grid">
              {recommendations.map((recommendation) => {
                const place = placeById.get(recommendation.placeId)!;
                return (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    favorite={trip.favoritePlaceIds.includes(place.id)}
                    disabled={isOffline}
                    recommendation={recommendation}
                    onFavorite={() =>
                      commit({
                        type: trip.favoritePlaceIds.includes(place.id)
                          ? "remove-favorite"
                          : "add-favorite",
                        placeId: place.id,
                      })
                    }
                    onAdd={() => {
                      setSelectedPlace(place);
                      setPlanDate(trip.startDate);
                    }}
                  />
                );
              })}
            </div>
            {!recommendations.length && (
              <p>
                No saved ideas yet. Add a place through your GPT, then come back
                to see what fits today.
              </p>
            )}
          </>
        )}

        {view === "ideas" && (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">YOUR FINDS</p>
                <h2>Ideas worth keeping close</h2>
              </div>
            </div>
            <div className="filters">
              <label>
                Search places
                <input
                  type="search"
                  aria-label="Search places"
                  value={search}
                  onChange={(event) =>
                    setIdeaFilters(event.target.value, interest)
                  }
                />
              </label>
              <label>
                Interest
                <select
                  aria-label="Interest"
                  value={interest}
                  onChange={(event) =>
                    setIdeaFilters(search, event.target.value)
                  }
                >
                  <option value="">All interests</option>
                  {[
                    "coast",
                    "outdoors",
                    "food",
                    "culture",
                    "history",
                    "wildlife",
                    "nightlife",
                    "shopping",
                    "relaxing",
                  ].map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="card-grid">
              {visiblePlaces.map((place) => (
                <PlaceCard
                  key={place.id}
                  place={place}
                  favorite={trip.favoritePlaceIds.includes(place.id)}
                  disabled={isOffline}
                  onFavorite={() =>
                    commit({
                      type: trip.favoritePlaceIds.includes(place.id)
                        ? "remove-favorite"
                        : "add-favorite",
                      placeId: place.id,
                    })
                  }
                  onAdd={() => {
                    setSelectedPlace(place);
                    setPlanDate(trip.startDate);
                  }}
                />
              ))}
            </div>
          </>
        )}

        {view === "plan" && (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">THE SHAPE OF THE TRIP</p>
                <h2>Loose enough to breathe. Clear enough to follow.</h2>
              </div>
            </div>
            {pendingProposal && (
              <section className="trip-snapshot" aria-label="Plan proposal">
                <p className="eyebrow">A DRAFT FROM YOUR CONVERSATION</p>
                <h3>{pendingProposal.summary}</h3>
                <ul>
                  {pendingProposal.changes.map((change, index) => (
                    <li key={`${change.type}-${index}`}>{change.rationale}</li>
                  ))}
                </ul>
                {pendingProposal.baseVersion === trip.version ? (
                  <div className="card-actions">
                    <button
                      className="primary"
                      onClick={() =>
                        commit({
                          type: "apply-plan-proposal",
                          proposalId: pendingProposal.id,
                        })
                      }
                    >
                      Apply proposal
                    </button>
                    <button
                      onClick={() =>
                        commit({
                          type: "dismiss-plan-proposal",
                          proposalId: pendingProposal.id,
                        })
                      }
                    >
                      Dismiss proposal
                    </button>
                  </div>
                ) : (
                  <p className="caution">
                    This proposal is stale. Ask ChatGPT to regenerate it.
                  </p>
                )}
              </section>
            )}
            <div className="day-list">
              {tripDates.map((date) => {
                const items = trip.itinerary
                  .filter((item) => item.date === date)
                  .sort(
                    (left, right) =>
                      (left.startTime ? 0 : 1) - (right.startTime ? 0 : 1) ||
                      (left.startTime ?? "").localeCompare(
                        right.startTime ?? "",
                      ) ||
                      left.order - right.order,
                  );
                return (
                  <section
                    className="itinerary-day"
                    data-testid="itinerary-day"
                    key={date}
                  >
                    <h3>
                      {dateLabel(date)}
                      {date === today ? " · Today" : ""}
                    </h3>
                    {!items.length && (
                      <p>
                        {date === trip.startDate
                          ? "Add a saved place when something feels right."
                          : "Nothing planned yet—choose something from Ideas."}
                      </p>
                    )}
                    <ol>
                      {items.map((item, index) => {
                        const place = placeById.get(item.placeId);
                        if (!place) return null;
                        return (
                          <li data-testid="itinerary-item" key={item.id}>
                            <div>
                              <strong>
                                {place.name} · {item.status}
                              </strong>
                              <span>{item.startTime ?? "Any time"}</span>
                            </div>
                            <div className="item-actions">
                              {item.status === "tentative" && (
                                <button
                                  onClick={() =>
                                    commit({
                                      type: "update-itinerary-item",
                                      itemId: item.id,
                                      changes: { status: "confirmed" },
                                    })
                                  }
                                  aria-label={`Confirm ${place.name}`}
                                >
                                  Confirm
                                </button>
                              )}
                              <button aria-label={`Edit ${place.name}`}>
                                Edit
                              </button>
                              <button
                                disabled={index === 0}
                                aria-label={`Move ${place.name} up`}
                              >
                                ↑
                              </button>
                              <button
                                onClick={() =>
                                  commit({
                                    type: "remove-itinerary-item",
                                    itemId: item.id,
                                  })
                                }
                                aria-label={`Remove ${place.name}`}
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {view === "ask" && (
          <TripChat
            token={token}
            trip={trip}
            online={!isOffline}
            onAddSuggestion={addSuggestedPlace}
            onViewSavedPlace={viewSavedPlace}
            onTripVersion={refreshTripAfterAsk}
          />
        )}
      </main>

      {selectedPlace && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-place-title"
          >
            <h2 id="add-place-title">Add {selectedPlace.name}</h2>
            <label>
              Plan date
              <select
                aria-label="Plan date"
                value={planDate}
                onChange={(event) => setPlanDate(event.target.value)}
              >
                {tripDates.map((date) => (
                  <option key={date} value={date}>
                    {dateLabel(date)}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button onClick={() => setSelectedPlace(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  void commit({
                    type: "add-itinerary-item",
                    item: {
                      placeId: selectedPlace.id,
                      date: planDate,
                      startTime: null,
                      durationMinutes: selectedPlace.durationMinutes,
                      notes: "",
                      status: "confirmed",
                    },
                  });
                  setSelectedPlace(null);
                }}
              >
                Add to plan
              </button>
            </div>
          </section>
        </div>
      )}

      {chatGptOpen && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chatgpt-title"
          >
            <h2 id="chatgpt-title">Bring this trip into ChatGPT</h2>
            <p>
              Anyone with this private link can view, edit, and delete the trip.
              Paste it only into a conversation you trust.
            </p>
            <div className="modal-actions">
              <button onClick={() => setChatGptOpen(false)}>Cancel</button>
              <button className="primary" onClick={copyForChatGpt}>
                Copy private link
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteOpen && (
        <div
          className="modal-backdrop"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDeleteOpen(false);
              queueMicrotask(() => deleteTriggerRef.current?.focus());
            }
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <h2 id="delete-title">Delete trip</h2>
            <p>This is permanent for everyone using the shared link.</p>
            <label>
              Type DELETE to confirm
              <input
                ref={deleteInputRef}
                aria-label="Type DELETE to confirm"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setDeleteOpen(false);
                  queueMicrotask(() => deleteTriggerRef.current?.focus());
                }}
              >
                Cancel
              </button>
              <button
                className="danger"
                disabled={deleteConfirmation !== "DELETE"}
                onClick={deleteTrip}
              >
                Delete permanently
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function normalizeSearch(value: string) {
  return value.normalize().toLocaleLowerCase();
}
