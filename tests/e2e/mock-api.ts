import type { Page, Route } from "@playwright/test";

import { makeConditionsV2, makeTripV2, SHARE_TOKEN } from "../web/fixtures";

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

export async function mockTripApi(page: Page) {
  let trip = makeTripV2();

  await page.route("**/api/conditions**", (route) =>
    json(route, makeConditionsV2()),
  );
  await page.route("**/api/trip", async (route) => {
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
    }
    return json(route, { trip });
  });

  return {
    getTrip: () => trip,
    setTrip: (next: ReturnType<typeof makeTripV2>) => {
      trip = next;
    },
  };
}
