import { describe, expect, it, vi } from "vitest";

import {
  loadTripSnapshot,
  removeTripSnapshot,
  saveTripSnapshot,
} from "@/lib/offline/trip-snapshot";
import { resolveRankingLocation } from "@/lib/recommendations/location";
import {
  createConditionRefreshPolicy,
  createTripRefreshPolicy,
  mutateTripWithRetry,
} from "@/lib/trips/client";
import { makeTripV2, SHARE_TOKEN } from "./fixtures";

// @spec TRIP-BE-006, CHAT-BE-006
it("reapplies a semantic mutation to the latest document after one conflict", async () => {
  const latest = makeTripV2({ version: 2, title: "Changed elsewhere" });
  const request = vi
    .fn()
    .mockResolvedValueOnce({ status: 409, trip: latest })
    .mockResolvedValueOnce({
      status: 200,
      trip: makeTripV2({
        version: 3,
        title: "Changed elsewhere",
        favoritePlaceIds: ["balboa-park"],
      }),
    });

  const result = await mutateTripWithRetry({
    trip: makeTripV2(),
    mutationId: "90cb919a-cf40-49be-8f0c-cf0556bd8bf7",
    mutation: { type: "add-favorite", placeId: "balboa-park" },
    request,
  });

  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0].baseVersion).toBe(2);
  expect(result.trip.favoritePlaceIds).toContain("balboa-park");
  expect(result.trip.title).toBe("Changed elsewhere");
});

// @spec TRIP-BE-007, CHAT-BE-007
it("stops after a second conflict and preserves the draft", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ status: 409, trip: makeTripV2({ version: 2 }) });
  const draft = { notes: "Do not lose this" };
  const result = await mutateTripWithRetry({
    trip: makeTripV2(),
    mutationId: "90cb919a-cf40-49be-8f0c-cf0556bd8bf7",
    mutation: { type: "update-itinerary-item", itemId: "a", changes: draft },
    request,
    draft,
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ status: "conflict", draft });
});

// @spec CHAT-BE-027
it("retries a complete bulk suggestion mutation once with the same mutation identifier", async () => {
  const latest = makeTripV2({ version: 2, title: "Changed elsewhere" });
  const request = vi
    .fn()
    .mockResolvedValueOnce({ status: 409, trip: latest })
    .mockResolvedValueOnce({
      status: 200,
      trip: makeTripV2({ version: 3, title: "Changed elsewhere" }),
    });
  const mutationId = "90cb919a-cf40-49be-8f0c-cf0556bd8bf7";
  const mutation = {
    type: "add-suggested-places",
    suggestions: [
      {
        name: "La Puerta",
        summary: "A lively Gaslamp Mexican restaurant for a downtown meal.",
        locality: "Gaslamp",
        interests: ["food"],
        tags: ["mexican", "casual"],
        profile: "indoor",
        preferredDayparts: ["evening"],
        durationMinutes: 90,
        costLevel: 2,
        reservationRecommended: false,
        sourceUrl: null,
      },
    ],
  } as never;

  await mutateTripWithRetry({
    trip: makeTripV2(),
    mutationId,
    mutation,
    request,
    draft: mutation,
  });

  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][0]).toMatchObject({ mutationId, mutation });
  expect(request.mock.calls[1][0]).toMatchObject({
    baseVersion: 2,
    mutationId,
    mutation,
  });
});

// @spec PWA-DATA-001, SEC-DATA-001
it("stores a versioned trip snapshot under a hash-derived key without the token", async () => {
  await saveTripSnapshot(SHARE_TOKEN, makeTripV2());
  const keys = await indexedDB.databases();
  expect(JSON.stringify(keys)).not.toContain(SHARE_TOKEN);
  expect(await loadTripSnapshot(SHARE_TOKEN)).toMatchObject({
    schemaVersion: 1,
    trip: makeTripV2(),
  });
});

// @spec PWA-DATA-002
it("deletes an invalid cached trip snapshot", async () => {
  await saveTripSnapshot(SHARE_TOKEN, { invalid: true });
  expect(await loadTripSnapshot(SHARE_TOKEN)).toBeNull();
});

// @spec TRIP-UI-006, TRIP-NAV-003
it("removes a matching snapshot after deletion or an expired response", async () => {
  await saveTripSnapshot(SHARE_TOKEN, makeTripV2());
  await removeTripSnapshot(SHARE_TOKEN);
  expect(await loadTripSnapshot(SHARE_TOKEN)).toBeNull();
});

// @spec REC-UI-001, REC-UI-002
it("requests location after a gesture and keeps coordinates in memory", async () => {
  const getCurrentPosition = vi.fn((success) =>
    success({ coords: { latitude: 32.72, longitude: -117.16 } }),
  );
  const result = await resolveRankingLocation({
    requestedByUser: true,
    geolocation: { getCurrentPosition },
    homeBase: null,
  });
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  expect(result).toEqual({
    latitude: 32.72,
    longitude: -117.16,
    source: "device",
  });
  expect(localStorage.length).toBe(0);
});

// @spec REC-UI-003, REC-UI-004, SEC-DATA-002
it("falls back without transmitting coordinates or automatically reprompting", async () => {
  const getCurrentPosition = vi.fn((_success, failure) =>
    failure(new Error("denied")),
  );
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const first = await resolveRankingLocation({
    requestedByUser: true,
    geolocation: { getCurrentPosition },
    homeBase: { latitude: 32.73, longitude: -117.17 },
  });
  const second = await resolveRankingLocation({
    requestedByUser: false,
    geolocation: { getCurrentPosition },
    homeBase: { latitude: 32.73, longitude: -117.17 },
  });
  expect(first.source).toBe("home-base");
  expect(second.source).toBe("home-base");
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  expect(fetchSpy).not.toHaveBeenCalled();
});

// @spec PWA-PROC-005, PWA-PROC-006, PWA-UI-005
describe("remote refresh policies", () => {
  it("refreshes trips on the 15-second visibility/focus/reconnect policy", () => {
    expect(createTripRefreshPolicy()).toMatchObject({
      refreshInterval: 15_000,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    });
  });

  it("refreshes conditions every 15 minutes while online", () => {
    expect(createConditionRefreshPolicy()).toMatchObject({
      refreshInterval: 900_000,
      refreshWhenHidden: false,
      revalidateOnReconnect: true,
    });
  });
});

// @spec PWA-UI-004
it("continues without snapshots when browser persistence fails", async () => {
  vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
    throw new DOMException("disabled");
  });
  await expect(saveTripSnapshot(SHARE_TOKEN, makeTripV2())).resolves.toBe(
    false,
  );
});
