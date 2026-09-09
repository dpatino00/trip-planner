import type { ItineraryItem, TripDocument, TripMutation } from "@/lib/types";
import { createTripInputSchema, tripDocumentSchema } from "@/lib/trips/schema";

const defaults = {
  interests: ["outdoors", "food", "culture", "relaxing"] as const,
  maximumCost: 2 as const,
  pace: "balanced" as const,
  mobility: "standard" as const,
  notes: "",
};

// @spec TRIP-DATA-008
export function calculateTripExpiry(createdAt: Date, endDate: string) {
  const afterCreation = new Date(createdAt.getTime() + 30 * 86_400_000);
  const afterTrip = new Date(
    Date.parse(`${endDate}T07:00:00.000Z`) + 180 * 86_400_000 - 1,
  );
  return new Date(
    Math.max(afterCreation.getTime(), afterTrip.getTime()),
  ).toISOString();
}

// @spec TRIP-DATA-001, TRIP-DATA-003, TRIP-DATA-008
export function createTripDocument(
  input: unknown,
  now = new Date(),
): TripDocument {
  const parsed = createTripInputSchema.parse(input);
  return tripDocumentSchema.parse({
    schemaVersion: 2,
    version: 1,
    ...parsed,
    homeBase: parsed.homeBase ?? null,
    preferences: parsed.preferences ?? {
      ...defaults,
      interests: [...defaults.interests],
    },
    places: [],
    favoritePlaceIds: [],
    itinerary: [],
    proposals: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: calculateTripExpiry(now, parsed.endDate),
  }) as TripDocument;
}

function nextOrder(items: ItineraryItem[], date: string) {
  return items.reduce(
    (next, item) =>
      item.date === date ? Math.max(next, item.order + 1) : next,
    0,
  );
}

// @spec TRIP-DATA-009, TRIP-BE-008, PLAN-BE-001, PLAN-BE-002, PLAN-BE-003
export function applyTripMutation(
  trip: TripDocument,
  mutation: TripMutation,
): TripDocument {
  let next: TripDocument = structuredClone(trip);
  switch (mutation.type) {
    case "update-details": {
      const excluded = trip.itinerary
        .filter(
          (item) =>
            item.date < mutation.startDate || item.date > mutation.endDate,
        )
        .map((item) => item.date);
      if (excluded.length) {
        throw new Error(
          `Move or remove itinerary items on ${[...new Set(excluded)].join(", ")}`,
        );
      }
      next = { ...next, ...mutation };
      delete (next as TripDocument & { type?: string }).type;
      break;
    }
    case "set-destination":
      next.destination = mutation.destination;
      break;
    case "set-preferences":
      next.preferences = mutation.preferences;
      break;
    case "add-place":
      if (next.places.some((place) => place.id === mutation.place.id)) {
        throw new Error("Place already exists");
      }
      next.places.push(mutation.place);
      break;
    case "update-place": {
      const index = next.places.findIndex(
        (place) => place.id === mutation.placeId,
      );
      if (index < 0) throw new Error("Place does not exist");
      next.places[index] = {
        ...next.places[index],
        ...mutation.changes,
        updatedAt: new Date().toISOString(),
      };
      break;
    }
    case "remove-place": {
      const index = next.places.findIndex(
        (place) => place.id === mutation.placeId,
      );
      if (index < 0) throw new Error("Place does not exist");
      next.places.splice(index, 1);
      next.favoritePlaceIds = next.favoritePlaceIds.filter(
        (id) => id !== mutation.placeId,
      );
      next.itinerary = next.itinerary.filter(
        (item) => item.placeId !== mutation.placeId,
      );
      break;
    }
    case "add-favorite":
      if (!next.places.some((place) => place.id === mutation.placeId)) {
        throw new Error("Place does not exist");
      }
      next.favoritePlaceIds = [
        ...new Set([...next.favoritePlaceIds, mutation.placeId]),
      ];
      break;
    case "remove-favorite":
      next.favoritePlaceIds = next.favoritePlaceIds.filter(
        (id) => id !== mutation.placeId,
      );
      break;
    case "add-itinerary-item":
      if (!next.places.some((place) => place.id === mutation.item.placeId)) {
        throw new Error("Place does not exist");
      }
      next.itinerary.push({
        ...mutation.item,
        id: crypto.randomUUID(),
        order: nextOrder(next.itinerary, mutation.item.date),
      });
      break;
    case "update-itinerary-item": {
      const index = next.itinerary.findIndex(
        (item) => item.id === mutation.itemId,
      );
      if (index < 0) throw new Error("Itinerary item does not exist");
      const previous = next.itinerary[index];
      const destinationDate = mutation.changes.date ?? previous.date;
      next.itinerary[index] = {
        ...previous,
        ...mutation.changes,
        order:
          destinationDate === previous.date
            ? previous.order
            : nextOrder(
                next.itinerary.filter((item) => item.id !== previous.id),
                destinationDate,
              ),
      };
      break;
    }
    case "remove-itinerary-item": {
      const index = next.itinerary.findIndex(
        (item) => item.id === mutation.itemId,
      );
      if (index < 0) throw new Error("Itinerary item does not exist");
      next.itinerary.splice(index, 1);
      break;
    }
    case "reorder-itinerary-day": {
      const actual = next.itinerary
        .filter((item) => item.date === mutation.date)
        .map((item) => item.id)
        .sort();
      const supplied = [...mutation.orderedItemIds].sort();
      if (
        actual.length !== supplied.length ||
        actual.some((id, index) => id !== supplied[index])
      ) {
        throw new Error("Day order must contain every current item");
      }
      const order = new Map(
        mutation.orderedItemIds.map((id, index) => [id, index]),
      );
      next.itinerary = next.itinerary.map((item) =>
        item.date === mutation.date
          ? { ...item, order: order.get(item.id)! }
          : item,
      );
      break;
    }
    case "store-plan-proposal": {
      next.proposals = [
        mutation.proposal,
        ...next.proposals.map((proposal) =>
          proposal.status === "pending"
            ? { ...proposal, status: "superseded" as const }
            : proposal,
        ),
      ]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 3);
      break;
    }
    case "dismiss-plan-proposal": {
      const proposal = next.proposals.find(
        (item) => item.id === mutation.proposalId,
      );
      if (!proposal) throw new Error("Proposal does not exist");
      if (proposal.status !== "pending") {
        throw new Error("Proposal is not pending");
      }
      proposal.status = "dismissed";
      break;
    }
    case "apply-plan-proposal": {
      const proposal = next.proposals.find(
        (item) => item.id === mutation.proposalId,
      );
      if (!proposal) throw new Error("Proposal does not exist");
      if (proposal.status !== "pending") {
        throw new Error("Proposal is not pending");
      }
      if (proposal.baseVersion !== trip.version) {
        throw new Error("Proposal version is stale");
      }
      for (const change of proposal.changes) {
        if (change.type === "add-item") {
          if (next.itinerary.some((item) => item.placeId === change.placeId)) {
            continue;
          }
          const place = next.places.find((item) => item.id === change.placeId);
          if (!place) throw new Error("Proposal references an unknown place");
          next.itinerary.push({
            id: crypto.randomUUID(),
            placeId: place.id,
            date: change.date,
            startTime: change.startTime,
            durationMinutes: place.durationMinutes,
            order: nextOrder(next.itinerary, change.date),
            notes: "",
            status: "tentative",
          });
        } else if (change.type === "move-tentative-item") {
          const item = next.itinerary.find(
            (candidate) => candidate.id === change.itemId,
          );
          if (!item || item.status !== "tentative") {
            throw new Error("Proposal cannot move a confirmed item");
          }
          item.date = change.date;
          item.startTime = change.startTime;
          item.order = nextOrder(next.itinerary, change.date);
        } else {
          const itemMap = new Map(
            next.itinerary
              .filter((item) => item.date === change.date)
              .map((item) => [item.id, item]),
          );
          for (const id of change.orderedItemIds) {
            const item = itemMap.get(id);
            if (!item || item.status !== "tentative") {
              throw new Error("Proposal cannot reorder a confirmed item");
            }
          }
          const order = new Map(
            change.orderedItemIds.map((id, index) => [id, index]),
          );
          for (const item of next.itinerary) {
            if (order.has(item.id)) item.order = order.get(item.id)!;
          }
        }
      }
      proposal.status = "applied";
      break;
    }
  }
  return tripDocumentSchema.parse(next) as TripDocument;
}
