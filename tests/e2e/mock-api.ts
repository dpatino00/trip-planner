import type { Page, Route } from "@playwright/test";

import type { SavedPlace } from "../../lib/types";
import { makeConditionsV2, makeTripV2, SHARE_TOKEN } from "../web/fixtures";

type MockTrip = ReturnType<typeof makeTripV2>;

export interface MockTripBackend {
  getTrip: () => MockTrip;
  setTrip: (trip: MockTrip) => void;
  consumeDroppedSuggestionResponse: () => boolean;
}

export function createMockTripBackend(
  initial: MockTrip = makeTripV2(),
  options: { dropFirstSuggestionResponse?: boolean } = {},
): MockTripBackend {
  let trip = initial;
  let dropSuggestionResponse = options.dropFirstSuggestionResponse ?? false;
  return {
    getTrip: () => trip,
    setTrip: (next) => {
      trip = next;
    },
    consumeDroppedSuggestionResponse: () => {
      const shouldDrop = dropSuggestionResponse;
      dropSuggestionResponse = false;
      return shouldDrop;
    },
  };
}

function json(
  route: Route,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

export async function mockTripApi(
  page: Page,
  backend: MockTripBackend = createMockTripBackend(),
) {
  await page.route("**/api/conditions**", (route) =>
    json(route, makeConditionsV2()),
  );
  await page.route("**/api/trip/chat", (route) => {
    const request = route.request().postDataJSON() as { message?: string };
    if (/torrey pines/i.test(request.message ?? "")) {
      const current = backend.getTrip();
      const sourceUrl = "https://www.parks.ca.gov/torreypines";
      const trip = {
        ...current,
        version: current.version + 1,
        places: current.places.map((place: SavedPlace) =>
          place.id === "place-torrey-pines" && !place.sourceUrl
            ? { ...place, sourceUrl }
            : place,
        ),
      };
      backend.setTrip(trip);
      return json(route, {
        message: "Torrey Pines is already in your Ideas.",
        savedPlaceIds: ["place-torrey-pines"],
        suggestions: [],
        unresolvedPlaceNames: [],
        tripVersion: trip.version,
      });
    }
    if (
      /add|save|include|import/i.test(request.message ?? "") &&
      /la puerta/i.test(request.message ?? "") &&
      /ironside/i.test(request.message ?? "") &&
      /garage kitchen/i.test(request.message ?? "")
    ) {
      return json(route, {
        message: "I found three reviewable additions.",
        savedPlaceIds: [],
        suggestions: [
          {
            name: "La Puerta",
            summary:
              "A lively Gaslamp Mexican restaurant for a downtown meal. The supplied happy-hour notes remain unverified.",
            locality: "Gaslamp",
            interests: ["food", "nightlife"],
            tags: ["mexican", "casual", "gaslamp"],
            profile: "indoor",
            preferredDayparts: ["afternoon", "evening"],
            durationMinutes: 90,
            costLevel: 2,
            reservationRecommended: false,
            sourceUrl: "https://gaslamp.org/listing/la-puerta/",
          },
          {
            name: "Ironside Fish & Oyster",
            summary:
              "A lively Little Italy seafood restaurant known for oysters. The supplied happy-hour notes remain unverified.",
            locality: "Little Italy",
            interests: ["food"],
            tags: ["seafood", "oysters", "little italy"],
            profile: "indoor",
            preferredDayparts: ["afternoon", "evening"],
            durationMinutes: 90,
            costLevel: 3,
            reservationRecommended: true,
            sourceUrl: "https://ironsidefishandoyster.com/",
          },
          {
            name: "Garage Kitchen + Bar",
            summary:
              "A casual Gaslamp restaurant for burgers, brunch, and drinks. The supplied happy-hour notes remain unverified.",
            locality: "Gaslamp",
            interests: ["food", "nightlife"],
            tags: ["american", "brunch", "casual"],
            profile: "indoor",
            preferredDayparts: ["afternoon", "evening"],
            durationMinutes: 90,
            costLevel: 2,
            reservationRecommended: false,
            sourceUrl: null,
          },
        ],
        unresolvedPlaceNames: [],
        tripVersion: backend.getTrip().version,
      });
    }
    if (
      /mexican/i.test(request.message ?? "") &&
      /saved|ideas|add|include/i.test(request.message ?? "")
    ) {
      return json(route, {
        message: "You already saved a Mexican seafood favorite.",
        savedPlaceIds: ["place-tacos"],
        suggestions: [],
        unresolvedPlaceNames: [],
        tripVersion: backend.getTrip().version,
      });
    }
    if (/mexican/i.test(request.message ?? "")) {
      return json(route, {
        message: "Here are some new Mexican options to consider.",
        savedPlaceIds: [],
        suggestions: [
          {
            name: "La Puerta",
            summary:
              "A lively Gaslamp Mexican restaurant for tacos and drinks.",
            locality: "Gaslamp",
            interests: ["food"],
            tags: ["mexican", "tacos", "casual"],
            profile: "indoor",
            preferredDayparts: ["evening"],
            durationMinutes: 90,
            costLevel: 2,
            reservationRecommended: false,
            sourceUrl: "https://gaslamp.org/listing/la-puerta/",
          },
        ],
        unresolvedPlaceNames: [],
        tripVersion: backend.getTrip().version,
      });
    }
    return json(route, {
      message: "La Jolla Cove could fit a relaxed coastal morning.",
      savedPlaceIds: [],
      suggestions: [
        {
          name: "La Jolla Cove",
          summary: "A compact coastal stop for views and wildlife.",
          locality: "La Jolla",
          interests: ["coast", "wildlife"],
          tags: ["coast", "sea lions"],
          profile: "coastal",
          preferredDayparts: ["morning"],
          durationMinutes: 90,
          costLevel: 0,
          reservationRecommended: false,
          sourceUrl: "https://www.sandiego.gov/lifeguards/beaches/cove",
        },
      ],
      unresolvedPlaceNames: [],
      tripVersion: backend.getTrip().version,
    });
  });
  await page.route("**/api/trip", async (route) => {
    let trip = backend.getTrip();
    const method = route.request().method();
    if (method === "POST")
      return json(route, { token: SHARE_TOKEN, trip }, 201);
    if (method === "GET")
      return json(route, { trip }, 200, { "cache-control": "no-store" });
    if (method === "DELETE") return route.fulfill({ status: 204 });
    if (method !== "PATCH") return route.fulfill({ status: 405 });

    const { mutation } = route.request().postDataJSON();
    if (mutation.type === "add-favorite") {
      trip = {
        ...trip,
        version: trip.version + 1,
        favoritePlaceIds: [
          ...new Set([...trip.favoritePlaceIds, mutation.placeId]),
        ],
      };
    } else if (mutation.type === "remove-favorite") {
      trip = {
        ...trip,
        version: trip.version + 1,
        favoritePlaceIds: trip.favoritePlaceIds.filter(
          (id: string) => id !== mutation.placeId,
        ),
      };
    } else if (mutation.type === "add-itinerary-item") {
      trip = {
        ...trip,
        version: trip.version + 1,
        itinerary: [
          ...trip.itinerary,
          {
            ...mutation.item,
            id: crypto.randomUUID(),
            order: trip.itinerary.length,
          },
        ],
      };
    } else if (mutation.type === "remove-itinerary-item") {
      trip = {
        ...trip,
        version: trip.version + 1,
        itinerary: trip.itinerary.filter(
          (item: { id: string }) => item.id !== mutation.itemId,
        ),
      };
    } else if (mutation.type === "update-itinerary-item") {
      trip = {
        ...trip,
        version: trip.version + 1,
        itinerary: trip.itinerary.map((item: { id: string }) =>
          item.id === mutation.itemId ? { ...item, ...mutation.changes } : item,
        ),
      };
    } else if (mutation.type === "dismiss-plan-proposal") {
      trip = {
        ...trip,
        version: trip.version + 1,
        proposals: trip.proposals.map((proposal: { id: string }) =>
          proposal.id === mutation.proposalId
            ? { ...proposal, status: "dismissed" }
            : proposal,
        ),
      };
    } else if (
      mutation.type === "add-suggested-place" ||
      mutation.type === "add-suggested-places"
    ) {
      const suggestions =
        mutation.type === "add-suggested-place"
          ? [mutation.suggestion]
          : mutation.suggestions;
      const timestamp = "2026-09-06T12:00:00.000Z";
      const additions = suggestions.filter(
        (suggestion: { name: string; locality: string | null }) =>
          !trip.places.some(
            (place: SavedPlace) =>
              place.name.trim().toLocaleLowerCase() ===
                suggestion.name.trim().toLocaleLowerCase() &&
              (place.locality ?? "").trim().toLocaleLowerCase() ===
                (suggestion.locality ?? "").trim().toLocaleLowerCase(),
          ),
      );
      if (additions.length === 0) return json(route, { trip, duplicate: true });
      trip = {
        ...trip,
        version: trip.version + 1,
        places: [
          ...trip.places,
          ...additions.map(
            (suggestion: { name: string } & Record<string, unknown>) => ({
              ...suggestion,
              id: `place-${suggestion.name
                .toLocaleLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")}`,
              coordinates: null,
              waterContact: false,
              accessibility: [],
              origin: "chatgpt",
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          ),
        ],
      };
    }
    backend.setTrip(trip);
    if (
      (mutation.type === "add-suggested-place" ||
        mutation.type === "add-suggested-places") &&
      backend.consumeDroppedSuggestionResponse()
    ) {
      return route.abort();
    }
    return json(route, { trip });
  });

  return backend;
}
