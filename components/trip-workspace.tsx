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
import { tripCopy } from "@/lib/ui/copy";
import type { GeocodingResult } from "@/lib/geocoding/open-meteo";
import type {
  ConditionsEnvelope,
  ItineraryItem,
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

function mutationIsPresent(trip: TripDocument, mutation: TripApiMutation) {
  if (mutation.type === "update-itinerary-item") {
    const item = trip.itinerary.find(
      (candidate) => candidate.id === mutation.itemId,
    );
    return Boolean(
      item &&
      Object.entries(mutation.changes).every(
        ([key, value]) => item[key as keyof typeof item] === value,
      ),
    );
  }
  if (mutation.type === "reorder-itinerary-day") {
    const actual = trip.itinerary
      .filter((item) => item.date === mutation.date)
      .sort((left, right) => left.order - right.order)
      .map((item) => item.id);
    return (
      actual.length === mutation.orderedItemIds.length &&
      actual.every((id, index) => id === mutation.orderedItemIds[index])
    );
  }
  if (mutation.type === "remove-itinerary-item") {
    return !trip.itinerary.some((item) => item.id === mutation.itemId);
  }
  return false;
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

// @spec TRIP-NAV-001, TRIP-NAV-002, TRIP-NAV-003, APP-UI-001, APP-UI-002, APP-UI-010, APP-UI-011, REC-UI-006, PLAN-UI-011
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
  const [locationQuery, setLocationQuery] = useState<string | null>(null);
  const [locationResults, setLocationResults] = useState<GeocodingResult[]>([]);
  const [locationBusy, setLocationBusy] = useState(false);
  const [destinationLocationMessage, setDestinationLocationMessage] =
    useState("");
  const [manualLatitude, setManualLatitude] = useState<string | null>(null);
  const [manualLongitude, setManualLongitude] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<SavedPlace | null>(null);
  const [planDate, setPlanDate] = useState("");
  const [editingItem, setEditingItem] = useState<ItineraryItem | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editDurationMinutes, setEditDurationMinutes] = useState("");
  const [editNotes, setEditNotes] = useState("");
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
        return { status: "conflict" as const, trip: outcome.trip };
      }
      await tripState.mutate({ trip: outcome.trip }, false);
      setCachedTrip(outcome.trip);
      await saveTripSnapshot(token, outcome.trip);
      return {
        status: outcome.duplicate ? ("duplicate" as const) : ("saved" as const),
        trip: outcome.trip,
      };
    } catch (cause) {
      try {
        const refreshed = await tripState.mutate();
        const refreshedTrip = refreshed?.trip;
        if (refreshedTrip && mutationIsPresent(refreshedTrip, mutation)) {
          setCachedTrip(refreshedTrip);
          await saveTripSnapshot(token, refreshedTrip);
          setMutationError("");
          return { status: "saved" as const, trip: refreshedTrip };
        }
      } catch {
        // Preserve the original error when reconciliation is unavailable.
      }
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

  async function findDestination() {
    const query = locationQuery ?? trip?.destination.name ?? "";
    if (!token || !query.trim()) return;
    setLocationBusy(true);
    setDestinationLocationMessage("");
    setLocationResults([]);
    try {
      const response = await fetch(
        `/api/trip/geocode?query=${encodeURIComponent(query.trim())}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const data = (await response.json()) as {
        results?: GeocodingResult[];
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(data.error?.message ?? "Location search failed");
      setLocationResults(data.results ?? []);
      if (!data.results?.length)
        setDestinationLocationMessage("No matching locations.");
    } catch (cause) {
      setDestinationLocationMessage(
        cause instanceof Error
          ? cause.message
          : "Location search is unavailable",
      );
    } finally {
      setLocationBusy(false);
    }
  }

  async function saveLocation(result: GeocodingResult) {
    if (!trip) return;
    const outcome = await performMutation({
      type: "set-destination",
      destination: {
        ...trip.destination,
        locality: result.locality,
        countryCode: result.countryCode,
        coordinates: result.coordinates,
        timeZone: result.timeZone,
      },
    });
    if (outcome.status === "saved" || outcome.status === "duplicate") {
      setLocationResults([]);
      setDestinationLocationMessage("Destination location saved.");
      setManualLatitude(String(result.coordinates.latitude));
      setManualLongitude(String(result.coordinates.longitude));
    }
  }

  async function saveManualLocation() {
    if (!trip) return;
    const latitude = Number(
      manualLatitude ?? trip.destination.coordinates?.latitude,
    );
    const longitude = Number(
      manualLongitude ?? trip.destination.coordinates?.longitude,
    );
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      setDestinationLocationMessage("Enter a valid latitude and longitude.");
      return;
    }
    const outcome = await performMutation({
      type: "set-destination",
      destination: {
        ...trip.destination,
        coordinates: { latitude, longitude },
      },
    });
    if (outcome.status === "saved" || outcome.status === "duplicate") {
      setLocationResults([]);
      setDestinationLocationMessage("Destination location saved.");
    }
  }

  async function commit(mutation: TripMutation) {
    await performMutation(mutation);
  }

  function openItineraryEditor(item: ItineraryItem) {
    setEditingItem(item);
    setEditDate(item.date);
    setEditStartTime(item.startTime ?? "");
    setEditDurationMinutes(
      item.durationMinutes === null ? "" : String(item.durationMinutes),
    );
    setEditNotes(item.notes);
  }

  async function saveItineraryItem() {
    if (!editingItem) return;
    const durationMinutes = editDurationMinutes
      ? Number(editDurationMinutes)
      : null;
    if (!Number.isInteger(durationMinutes) && durationMinutes !== null) {
      setMutationError("Duration must be a whole number of minutes.");
      return;
    }
    const outcome = await performMutation(
      {
        type: "update-itinerary-item",
        itemId: editingItem.id,
        changes: {
          date: editDate,
          startTime: editStartTime || null,
          durationMinutes,
          notes: editNotes,
        },
      },
      {
        date: editDate,
        startTime: editStartTime,
        durationMinutes: editDurationMinutes,
        notes: editNotes,
      },
    );
    if (outcome.status === "saved" || outcome.status === "duplicate") {
      setEditingItem(null);
    }
  }

  function moveUntimedItem(
    date: string,
    items: ItineraryItem[],
    itemId: string,
    direction: -1 | 1,
  ) {
    const untimedItemIds = items
      .filter((item) => item.startTime === null)
      .map((item) => item.id);
    const currentIndex = untimedItemIds.indexOf(itemId);
    const destinationIndex = currentIndex + direction;
    if (
      currentIndex < 0 ||
      destinationIndex < 0 ||
      destinationIndex >= untimedItemIds.length
    ) {
      return;
    }
    [untimedItemIds[currentIndex], untimedItemIds[destinationIndex]] = [
      untimedItemIds[destinationIndex],
      untimedItemIds[currentIndex],
    ];
    let untimedIndex = 0;
    void commit({
      type: "reorder-itinerary-day",
      date,
      orderedItemIds: items.map((item) =>
        item.startTime === null ? untimedItemIds[untimedIndex++] : item.id,
      ),
    });
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

  // @spec CHAT-BE-025, CHAT-BE-027, CHAT-BE-028, CHAT-UI-013
  function addSuggestedPlaces(suggestions: SuggestedPlace[]) {
    return (async () => {
      const originalTrip = trip;
      if (!originalTrip) {
        return { statuses: suggestions.map(() => "error" as const) };
      }
      const statusesFromTrip = (currentTrip: TripDocument) =>
        suggestions.map((suggestion) => {
          if (
            originalTrip.places.some((place) =>
              matchesSuggestedPlace(place, suggestion),
            )
          ) {
            return "duplicate" as const;
          }
          return currentTrip.places.some((place) =>
            matchesSuggestedPlace(place, suggestion),
          )
            ? ("saved" as const)
            : ("error" as const);
        });
      const outcome = await performMutation(
        { type: "add-suggested-places", suggestions },
        suggestions,
      );
      if (outcome.status === "conflict") {
        return { statuses: suggestions.map(() => "conflict" as const) };
      }
      if (outcome.status !== "error" && outcome.trip) {
        return { statuses: statusesFromTrip(outcome.trip) };
      }
      if (!token) return { statuses: suggestions.map(() => "error" as const) };

      try {
        const refreshed = await tripState.mutate();
        const refreshedTrip = refreshed?.trip;
        if (
          refreshedTrip &&
          suggestions.every((suggestion) =>
            refreshedTrip.places.some((place) =>
              matchesSuggestedPlace(place, suggestion),
            ),
          )
        ) {
          setCachedTrip(refreshedTrip);
          await saveTripSnapshot(token, refreshedTrip);
          setMutationError("");
          return { statuses: statusesFromTrip(refreshedTrip) };
        }
      } catch {
        // Preserve the original mutation error when reconciliation is unavailable.
      }
      return { statuses: suggestions.map(() => "error" as const) };
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
              <span className="private-pill">
                {tripCopy.workspace.privateTrip}
              </span>
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
            <div className="location-editor">
              <h3>Destination location</h3>
              <p>
                Add a location to enable live weather and air-quality details.
              </p>
              <label>
                Search for a place
                <input
                  value={locationQuery ?? trip.destination.name}
                  onChange={(event) => setLocationQuery(event.target.value)}
                  placeholder="San Diego, CA"
                />
              </label>
              <button
                type="button"
                disabled={
                  locationBusy ||
                  !(locationQuery ?? trip.destination.name).trim() ||
                  isOffline
                }
                onClick={() => void findDestination()}
              >
                {locationBusy ? "Searching…" : "Find location"}
              </button>
              {locationResults.length > 0 && (
                <div className="location-results" aria-label="Location results">
                  {locationResults.map((result) => (
                    <button
                      type="button"
                      key={`${result.name}-${result.coordinates.latitude}-${result.coordinates.longitude}`}
                      onClick={() => void saveLocation(result)}
                      disabled={isOffline || dirty}
                    >
                      <strong>{result.name}</strong>
                      <span>
                        {[result.locality, result.countryCode]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="field-pair">
                <label>
                  Latitude
                  <input
                    inputMode="decimal"
                    value={
                      manualLatitude ??
                      (trip.destination.coordinates
                        ? String(trip.destination.coordinates.latitude)
                        : "")
                    }
                    onChange={(event) => setManualLatitude(event.target.value)}
                    placeholder="32.7157"
                  />
                </label>
                <label>
                  Longitude
                  <input
                    inputMode="decimal"
                    value={
                      manualLongitude ??
                      (trip.destination.coordinates
                        ? String(trip.destination.coordinates.longitude)
                        : "")
                    }
                    onChange={(event) => setManualLongitude(event.target.value)}
                    placeholder="-117.1611"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={isOffline || dirty}
                onClick={() => void saveManualLocation()}
              >
                Save coordinates
              </button>
              {destinationLocationMessage && (
                <p role="status" className="location-message">
                  {destinationLocationMessage}
                </p>
              )}
            </div>
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
                <p className="eyebrow">{tripCopy.workspace.today.eyebrow}</p>
                <h2>{tripCopy.workspace.today.heading}</h2>
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
                    <strong>
                      {tripCopy.workspace.today.unavailableHeading}
                    </strong>
                    <p>
                      {conditions.reason === "forecast-out-of-range"
                        ? tripCopy.workspace.today.unavailableOutOfRange
                        : tripCopy.workspace.today.unavailableFallback}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="condition-hero">
                      <strong>
                        {Math.round(conditions.temperatureF ?? 0)}°
                      </strong>
                      <div>
                        <h3>{tripCopy.workspace.today.liveHeading}</h3>
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
                <p className="eyebrow">
                  {tripCopy.workspace.today.summaryEyebrow}
                </p>
                <h3>{tripCopy.workspace.today.summaryHeading}</h3>
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
                <p className="eyebrow">
                  {tripCopy.workspace.today.recommendationsEyebrow}
                </p>
                <h2>{tripCopy.workspace.today.recommendationsHeading}</h2>
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
              <p>{tripCopy.workspace.today.noIdeas}</p>
            )}
          </>
        )}

        {view === "ideas" && (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">{tripCopy.workspace.ideas.eyebrow}</p>
                <h2>{tripCopy.workspace.ideas.heading}</h2>
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
                <p className="eyebrow">{tripCopy.workspace.plan.eyebrow}</p>
                <h2>{tripCopy.workspace.plan.heading}</h2>
              </div>
            </div>
            {pendingProposal && (
              <section className="trip-snapshot" aria-label="Plan proposal">
                <p className="eyebrow">
                  {tripCopy.workspace.plan.proposalEyebrow}
                </p>
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
                      {tripCopy.workspace.plan.apply}
                    </button>
                    <button
                      onClick={() =>
                        commit({
                          type: "dismiss-plan-proposal",
                          proposalId: pendingProposal.id,
                        })
                      }
                    >
                      {tripCopy.workspace.plan.dismiss}
                    </button>
                  </div>
                ) : (
                  <p className="caution">{tripCopy.workspace.plan.stale}</p>
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
                    {!items.length && <p>{tripCopy.workspace.plan.emptyDay}</p>}
                    <ol>
                      {items.map((item) => {
                        const place = placeById.get(item.placeId);
                        if (!place) return null;
                        const untimedItems = items.filter(
                          (candidate) => candidate.startTime === null,
                        );
                        const untimedIndex = untimedItems.findIndex(
                          (candidate) => candidate.id === item.id,
                        );
                        const isUntimed = item.startTime === null;
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
                                  disabled={isOffline}
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
                              <button
                                disabled={isOffline}
                                onClick={() => openItineraryEditor(item)}
                                aria-label={`Edit ${place.name}`}
                              >
                                Edit
                              </button>
                              <button
                                disabled={
                                  isOffline || !isUntimed || untimedIndex === 0
                                }
                                onClick={() =>
                                  moveUntimedItem(date, items, item.id, -1)
                                }
                                aria-label={`Move ${place.name} up`}
                              >
                                ↑
                              </button>
                              <button
                                disabled={
                                  isOffline ||
                                  !isUntimed ||
                                  untimedIndex === untimedItems.length - 1
                                }
                                onClick={() =>
                                  moveUntimedItem(date, items, item.id, 1)
                                }
                                aria-label={`Move ${place.name} down`}
                              >
                                ↓
                              </button>
                              <button
                                disabled={isOffline}
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
            onAddSuggestions={addSuggestedPlaces}
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

      {editingItem && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-itinerary-title"
          >
            <h2 id="edit-itinerary-title">Edit plan item</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveItineraryItem();
              }}
            >
              <label>
                Plan date
                <select
                  aria-label="Edit plan date"
                  value={editDate}
                  onChange={(event) => setEditDate(event.target.value)}
                >
                  {tripDates.map((date) => (
                    <option key={date} value={date}>
                      {dateLabel(date)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start time
                <input
                  aria-label="Start time"
                  type="time"
                  value={editStartTime}
                  onChange={(event) => setEditStartTime(event.target.value)}
                />
              </label>
              <label>
                Duration (minutes)
                <input
                  aria-label="Duration minutes"
                  type="number"
                  min="15"
                  max="1440"
                  step="1"
                  value={editDurationMinutes}
                  onChange={(event) =>
                    setEditDurationMinutes(event.target.value)
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  aria-label="Plan notes"
                  maxLength={500}
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setEditingItem(null)}>
                  Cancel
                </button>
                <button className="primary" type="submit">
                  Save changes
                </button>
              </div>
            </form>
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
