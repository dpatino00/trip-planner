import type { Page, Route } from "@playwright/test";

import type { SavedPlace } from "../../lib/types";
import { makeConditionsV2, makeTripV2, SHARE_TOKEN } from "../web/fixtures";

type MockTrip = ReturnType<typeof makeTripV2>;

export interface MockTripBackend {
  getTrip: () => MockTrip;
  setTrip: (trip: MockTrip) => void;
}

export function createMockTripBackend(
  initial: MockTrip = makeTripV2(),
): MockTripBackend {
  let trip = initial;
  return {
    getTrip: () => trip,
    setTrip: (next) => {
      trip = next;
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
  await page.route("**/api/trip/chat", (route) =>
    json(route, {
      message: "La Jolla Cove could fit a relaxed coastal morning.",
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
    }),
  );
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
    } else if (mutation.type === "add-suggested-place") {
      const duplicate = trip.places.some(
        (place: SavedPlace) =>
          place.name.trim().toLocaleLowerCase() ===
            mutation.suggestion.name.trim().toLocaleLowerCase() &&
          (place.locality ?? "").trim().toLocaleLowerCase() ===
            (mutation.suggestion.locality ?? "").trim().toLocaleLowerCase(),
      );
      if (duplicate) return json(route, { trip, duplicate: true });
      const timestamp = "2026-09-06T12:00:00.000Z";
      trip = {
        ...trip,
        version: trip.version + 1,
        places: [
          ...trip.places,
          {
            ...mutation.suggestion,
            id: "place-la-jolla-cove",
            coordinates: null,
            waterContact: false,
            accessibility: [],
            origin: "chatgpt",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      };
    }
    backend.setTrip(trip);
    return json(route, { trip });
  });

  return backend;
}
