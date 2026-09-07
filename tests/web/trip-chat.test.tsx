import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { TripChat } from "@/components/chat/trip-chat";
import { saveChatSession } from "@/lib/chat/session";
import { makeTripV2, SHARE_TOKEN } from "./fixtures";

const suggestion = {
  name: "La Jolla Cove",
  summary: "A compact coastal stop for dramatic views and local wildlife.",
  locality: "La Jolla",
  interests: ["coast" as const],
  tags: ["coast"],
  profile: "coastal" as const,
  preferredDayparts: ["morning" as const],
  durationMinutes: 90,
  costLevel: 0 as const,
  reservationRecommended: false,
  sourceUrl: "https://www.sandiego.gov/lifeguards/beaches/cove",
};

afterEach(cleanup);

// @spec CHAT-UI-002, CHAT-UI-003, CHAT-UI-004, CHAT-UI-005, CHAT-UI-007
it("submits with Enter, renders suggestions, dismisses locally, and confirms explicitly", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "Try this coastal stop.",
      savedPlaceIds: [],
      suggestions: [suggestion],
      tripVersion: 1,
    }),
  );
  const onAddSuggestion = vi.fn().mockResolvedValue({ status: "saved" });
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={onAddSuggestion}
      onViewSavedPlace={vi.fn()}
    />,
  );

  const composer = screen.getByLabelText("Ask about this trip");
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: "What should we do?" } });
  fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
  expect(composer).toHaveValue("What should we do?");
  fireEvent.keyDown(composer, { key: "Enter" });

  expect(await screen.findByText("Try this coastal stop.")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/trip/chat",
    expect.objectContaining({
      headers: expect.objectContaining({ "x-trip-chat-contract": "2" }),
    }),
  );
  expect(screen.getByText("La Jolla Cove")).toBeVisible();
  expect(screen.getByRole("link", { name: "Apple Maps" })).toHaveAttribute(
    "href",
    expect.stringContaining("maps.apple.com"),
  );
  expect(screen.getByRole("link", { name: "Google Maps" })).toHaveAttribute(
    "href",
    expect.stringContaining("google.com/maps/search"),
  );
  expect(screen.getByRole("link", { name: "Directions" })).toHaveAttribute(
    "href",
    expect.stringContaining("google.com/maps/dir"),
  );
  expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute(
    "href",
    suggestion.sourceUrl,
  );
  expect(onAddSuggestion).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Add La Jolla Cove to trip" }),
  );
  await waitFor(() => expect(onAddSuggestion).toHaveBeenCalledWith(suggestion));
  expect(await screen.findByText("Saved to Ideas")).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss La Jolla Cove" }),
  );
  expect(screen.queryByText("La Jolla Cove")).not.toBeInTheDocument();
});

// @spec CHAT-UI-006, PWA-UI-007
it("restores saved matches while disabling generation and confirmation offline", async () => {
  await saveChatSession(SHARE_TOKEN, [
    {
      id: "stored-match",
      role: "assistant",
      content: "This one is already in your trip.",
      savedPlaceIds: ["place-tacos"],
      suggestions: [],
    },
  ]);
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online={false}
      onAddSuggestion={vi.fn()}
      onViewSavedPlace={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Ask about this trip")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByText(/Connect to ask/)).toBeVisible();
  expect(
    await screen.findByText("This one is already in your trip."),
  ).toBeVisible();
  expect(screen.getByText("Oscar's Mexican Seafood")).toBeVisible();
  expect(screen.getByRole("link", { name: /Apple Maps/ })).toHaveAccessibleName(
    /requires connection/i,
  );
});

// @spec CHAT-UI-005, CHAT-BE-007
it("retains a suggestion after repeated conflicts so it can be retried", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "Try this coastal stop.",
      savedPlaceIds: [],
      suggestions: [suggestion],
      tripVersion: 1,
    }),
  );
  const onAddSuggestion = vi.fn().mockResolvedValue({ status: "conflict" });
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={onAddSuggestion}
      onViewSavedPlace={vi.fn()}
    />,
  );
  const composer = screen.getByLabelText("Ask about this trip");
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: "What should we do?" } });
  fireEvent.keyDown(composer, { key: "Enter" });
  const add = await screen.findByRole("button", {
    name: "Add La Jolla Cove to trip",
  });
  fireEvent.click(add);
  expect(await screen.findByText(/changed twice/i)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Retry adding La Jolla Cove to trip" }),
  ).toBeVisible();
});

// @spec CHAT-UI-002, CHAT-UI-008, CHAT-UI-009
it("renders authoritative saved matches in rank order with read-only actions", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "You already saved these Mexican-food options.",
      savedPlaceIds: ["place-tacos", "place-balboa-park"],
      suggestions: [],
      tripVersion: 1,
    }),
  );
  const onAddSuggestion = vi.fn();
  const onViewSavedPlace = vi.fn();
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={onAddSuggestion}
      onViewSavedPlace={onViewSavedPlace}
    />,
  );
  const composer = screen.getByLabelText("Ask about this trip");
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: "Mexican food" } });
  fireEvent.keyDown(composer, { key: "Enter" });

  const cards = await screen.findAllByTestId("saved-match-card");
  expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
    "Oscar's Mexican Seafood",
    "Balboa Park",
  ]);
  expect(cards[0]).toHaveTextContent("Casual seafood tacos.");
  expect(cards[0]).toHaveTextContent("tacos");
  expect(cards[0]).toHaveTextContent("casual");
  expect(
    within(cards[0]).getByRole("link", { name: "Visit source" }),
  ).toHaveAttribute("href", "https://oscarsmexicanseafood.com/");
  expect(
    screen.getAllByRole("link", { name: "Apple Maps" })[0],
  ).toHaveAttribute("href", expect.stringContaining("maps.apple.com"));
  expect(screen.queryByRole("button", { name: /add .* to trip/i })).toBeNull();
  expect(onAddSuggestion).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", {
      name: "View Oscar's Mexican Seafood in Ideas",
    }),
  );
  expect(onViewSavedPlace).toHaveBeenCalledWith("place-tacos");
});
