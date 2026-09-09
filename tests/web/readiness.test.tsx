import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { TripReadiness } from "@/components/trip-readiness";
import { getTripReadiness } from "@/lib/trips/readiness";
import { makeSavedPlace, makeTripV2 } from "./fixtures";

it("derives every readiness follow-up from existing trip data", () => {
  const trip = makeTripV2({
    favoritePlaceIds: ["place-torrey-pines", "missing-place"],
    places: [
      makeSavedPlace({ id: "place-confirmed" }),
      makeSavedPlace({
        id: "place-reservation",
        reservationRecommended: true,
      }),
      makeSavedPlace({ id: "place-torrey-pines" }),
    ],
    itinerary: [
      {
        id: "confirmed-stop",
        placeId: "place-confirmed",
        date: "2026-09-14",
        startTime: null,
        durationMinutes: 60,
        order: 1,
        notes: "",
        status: "confirmed",
      },
      {
        id: "tentative-reservation",
        placeId: "place-reservation",
        date: "2026-09-15",
        startTime: null,
        durationMinutes: 60,
        order: 1,
        notes: "",
        status: "tentative",
      },
      {
        id: "tentative-unknown-reservation",
        placeId: "missing-place",
        date: "2026-09-15",
        startTime: null,
        durationMinutes: 60,
        order: 2,
        notes: "",
        status: "tentative",
      },
    ],
  });

  expect(getTripReadiness(trip)).toEqual({
    emptyItineraryDays: 3,
    tentativeStops: 2,
    tentativeReservationStops: 1,
    unscheduledFavoriteIdeas: 1,
  });
});

it("renders an affirmative zero state and sends favorite follow-ups to Ideas", () => {
  const onViewIdeas = vi.fn();
  const { rerender } = render(
    <TripReadiness
      readiness={{
        emptyItineraryDays: 0,
        tentativeStops: 0,
        tentativeReservationStops: 0,
        unscheduledFavoriteIdeas: 0,
      }}
      onViewIdeas={onViewIdeas}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Your plan is looking settled" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review Ideas" })).toBeNull();

  rerender(
    <TripReadiness
      readiness={{
        emptyItineraryDays: 0,
        tentativeStops: 0,
        tentativeReservationStops: 0,
        unscheduledFavoriteIdeas: 2,
      }}
      onViewIdeas={onViewIdeas}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review Ideas" }));
  expect(onViewIdeas).toHaveBeenCalledOnce();
});
