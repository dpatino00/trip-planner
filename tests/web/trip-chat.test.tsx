import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { buildChatHistory, TripChat } from "@/components/chat/trip-chat";
import { chatSessionStorageKey, saveChatSession } from "@/lib/chat/session";
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

// @spec CHAT-DATA-008
it("sends only the newest bounded role-and-text history", () => {
  const messages = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    role: (index % 2 ? "assistant" : "user") as "assistant" | "user",
    content: String(index).repeat(3000),
    savedPlaceIds: ["place-tacos"],
    suggestions: [suggestion],
    unresolvedPlaceNames: ["Unknown venue"],
  }));

  const history = buildChatHistory(messages);
  expect(history).toHaveLength(4);
  expect(history.reduce((sum, item) => sum + item.content.length, 0)).toBe(
    8000,
  );
  expect(history.every((item) => item.content.length <= 2000)).toBe(true);
  expect(history.at(-1)?.content).toBe("7".repeat(2000));
  expect(JSON.stringify(history)).not.toMatch(
    /savedPlaceIds|suggestions|unresolvedPlaceNames/,
  );
});

// @spec CHAT-UI-002, CHAT-UI-003, CHAT-UI-004, CHAT-UI-005, CHAT-UI-007
it("submits with Enter, renders suggestions, dismisses locally, and confirms explicitly", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "Try this coastal stop.",
      savedPlaceIds: [],
      suggestions: [suggestion],
      unresolvedPlaceNames: [],
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
      headers: expect.objectContaining({ "x-trip-chat-contract": "3" }),
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

// @spec CHAT-DATA-001, CHAT-UI-007, CHAT-UI-016, CHAT-UI-017
it("submits a one-message Create cards choice and renders an unsourced event as a trip idea", async () => {
  const event = {
    ...suggestion,
    name: "Shakespeare in the Park",
    summary:
      "An outdoor Shakespeare performance named by the traveler for Friday evening. Schedule and availability details remain unverified.",
    locality: "Balboa Park",
    interests: ["culture" as const],
    tags: ["theater", "outdoor", "event"],
    profile: "outdoor" as const,
    preferredDayparts: ["evening" as const],
    durationMinutes: 150,
    costLevel: null,
    reservationRecommended: null,
    sourceUrl: null,
  };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "I made a card for the named event.",
      savedPlaceIds: [],
      suggestions: [event],
      unresolvedPlaceNames: [],
      tripVersion: 1,
    }),
  );
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={vi.fn()}
      onViewSavedPlace={vi.fn()}
    />,
  );

  const composer = screen.getByLabelText("Ask about this trip");
  const createCards = screen.getByRole("checkbox", { name: "Create cards" });
  await waitFor(() => expect(composer).toBeEnabled());
  expect(createCards).not.toBeChecked();
  fireEvent.click(createCards);
  fireEvent.change(composer, {
    target: { value: "Shakespeare in the Park on Friday" },
  });
  fireEvent.keyDown(composer, { key: "Enter" });

  await screen.findByText("I made a card for the named event.");
  expect(createCards).not.toBeChecked();
  const submitted = JSON.parse(
    String((fetchMock.mock.calls[0][1] as RequestInit).body),
  );
  expect(submitted).toMatchObject({
    message: "Shakespeare in the Park on Friday",
    createCards: true,
  });
  expect(JSON.stringify(submitted.history)).not.toContain("createCards");
  const card = screen.getByRole("article", {
    name: "Shakespeare in the Park",
  });
  expect(card).toHaveTextContent("TRIP IDEA · DETAILS UNVERIFIED");
  expect(within(card).queryByRole("link", { name: "Learn more" })).toBeNull();
  expect(within(card).getByRole("link", { name: "Apple Maps" })).toBeVisible();
});

// @spec CHAT-UI-006, PWA-UI-007
it("restores saved matches while disabling generation and confirmation offline", async () => {
  await saveChatSession(SHARE_TOKEN, [
    {
      id: "stored-match",
      role: "assistant",
      content: "This one is already in your trip.",
      savedPlaceIds: ["place-tacos"],
      suggestions: [
        suggestion,
        { ...suggestion, name: "La Puerta", sourceUrl: null },
      ],
      unresolvedPlaceNames: ["Garage Kitchen + Bar"],
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
  expect(screen.getByRole("checkbox", { name: "Create cards" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByText(/Connect to ask/)).toBeVisible();
  expect(
    await screen.findByText("This one is already in your trip."),
  ).toBeVisible();
  expect(screen.getByText("Oscar's Mexican Seafood")).toBeVisible();
  expect(screen.getByText("Garage Kitchen + Bar")).toBeVisible();
  expect(screen.getByRole("button", { name: "Add all new" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Add La Jolla Cove to trip" }),
  ).toBeDisabled();
  expect(
    within(screen.getByTestId("saved-match-card")).getByRole("link", {
      name: /Apple Maps/,
    }),
  ).toHaveAccessibleName(/requires connection/i);
});

// @spec CHAT-UI-005, CHAT-BE-007
it("retains a suggestion after repeated conflicts so it can be retried", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "Try this coastal stop.",
      savedPlaceIds: [],
      suggestions: [suggestion],
      unresolvedPlaceNames: [],
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
      unresolvedPlaceNames: [],
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

// @spec CHAT-UI-011
it("formats assistant paragraphs, lists, and safe markdown links", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message:
        "Here are ideas:\n\n1) Torrey Pines\n2) Balboa Park\n\n[See the official guide](https://www.parks.ca.gov/?page_id=657) <strong>safe text</strong>",
      savedPlaceIds: [],
      suggestions: [],
      unresolvedPlaceNames: [],
      tripVersion: 1,
    }),
  );
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={vi.fn()}
      onViewSavedPlace={vi.fn()}
    />,
  );

  const composer = screen.getByLabelText("Ask about this trip");
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: "Suggest some places" } });
  fireEvent.keyDown(composer, { key: "Enter" });

  const list = await screen.findByRole("list");
  expect(list).toHaveTextContent("Torrey Pines");
  expect(list).toHaveTextContent("Balboa Park");
  expect(
    screen.getByRole("link", { name: "See the official guide" }),
  ).toHaveAttribute("href", "https://www.parks.ca.gov/?page_id=657");
  expect(screen.getByText(/safe text/)).toBeVisible();
  expect(screen.queryByRole("strong")).toBeNull();
});

// @spec CHAT-DATA-004, CHAT-DATA-008, CHAT-UI-002, CHAT-UI-005, CHAT-UI-007, CHAT-UI-012, CHAT-UI-013, CHAT-UI-014, CHAT-BE-028
it("renders a batch, explains unresolved names, and adds all new cards together", async () => {
  const secondSuggestion = {
    ...suggestion,
    name: "La Puerta",
    locality: "Gaslamp",
    summary:
      "A lively Gaslamp Mexican restaurant for a downtown meal. Happy-hour details supplied by the traveler remain unverified.",
    tags: ["mexican", "casual", "gaslamp"],
    sourceUrl: null,
  };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "Review these additions.",
      savedPlaceIds: [],
      suggestions: [suggestion, secondSuggestion],
      unresolvedPlaceNames: ["Garage Kitchen + Bar"],
      tripVersion: 1,
    }),
  );
  const onAddSuggestions = vi.fn().mockResolvedValue({
    statuses: ["saved", "duplicate"],
  });
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={vi.fn()}
      onViewSavedPlace={vi.fn()}
      {...({ onAddSuggestions } as Record<string, unknown>)}
    />,
  );

  const composer = screen.getByLabelText("Ask about this trip");
  await waitFor(() => expect(composer).toBeEnabled());
  expect(composer).toHaveAttribute("maxlength", "8000");
  fireEvent.change(composer, {
    target: {
      value:
        "Please add La Jolla Cove, La Puerta, and Garage Kitchen + Bar from these notes.",
    },
  });
  fireEvent.keyDown(composer, { key: "Enter" });

  expect(await screen.findByText("Review these additions.")).toBeVisible();
  expect(screen.getByText("Garage Kitchen + Bar")).toBeVisible();
  expect(screen.getByText(/needs clarification/i)).toBeVisible();
  const laPuerta = screen.getByRole("article", { name: "La Puerta" });
  expect(
    within(laPuerta).queryByRole("link", { name: "Learn more" }),
  ).toBeNull();
  expect(
    within(laPuerta).getByRole("link", { name: "Apple Maps" }),
  ).toBeVisible();

  const addAll = screen.getByRole("button", { name: "Add all new" });
  fireEvent.click(addAll);
  await waitFor(() =>
    expect(onAddSuggestions).toHaveBeenCalledWith([
      suggestion,
      secondSuggestion,
    ]),
  );
  expect(await screen.findByText("Saved to Ideas")).toBeVisible();
  expect(screen.getByText("Already in Ideas")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/trip/chat",
    expect.objectContaining({
      headers: expect.objectContaining({ "x-trip-chat-contract": "3" }),
    }),
  );
});

// @spec CHAT-UI-015
it("cancels and confirms a tab-local new chat reset", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "Try this coastal stop.",
      savedPlaceIds: [],
      suggestions: [suggestion],
      unresolvedPlaceNames: ["Garage Kitchen + Bar"],
      tripVersion: 1,
    }),
  );
  const confirmMock = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
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
  fireEvent.change(composer, { target: { value: "Suggest a place" } });
  fireEvent.keyDown(composer, { key: "Enter" });
  expect(await screen.findByText("Try this coastal stop.")).toBeVisible();
  const newChat = screen.getByRole("button", { name: "New chat" });
  expect(newChat).toBeEnabled();

  fireEvent.click(newChat);
  expect(screen.getByText("Try this coastal stop.")).toBeVisible();
  expect(confirmMock).toHaveBeenCalledWith(
    "Start a new chat? This clears Ask history in this browser tab only.",
  );

  fireEvent.change(composer, { target: { value: "draft" } });
  fireEvent.click(newChat);
  await waitFor(() =>
    expect(screen.getByText("What do you need help with?")).toBeVisible(),
  );
  expect(screen.queryByText("Try this coastal stop.")).not.toBeInTheDocument();
  expect(screen.queryByText("Garage Kitchen + Bar")).not.toBeInTheDocument();
  expect(composer).toHaveValue("");
  expect(screen.getByRole("button", { name: "New chat" })).toBeDisabled();
  expect(
    sessionStorage.getItem(await chatSessionStorageKey(SHARE_TOKEN)),
  ).toBeNull();
  expect(onAddSuggestion).not.toHaveBeenCalled();
});

// @spec CHAT-UI-015
it("disables New chat while a request is in flight", async () => {
  let resolveFetch!: (response: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        resolveFetch = (response) => resolve(response);
      }),
  );
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={vi.fn()}
      onViewSavedPlace={vi.fn()}
    />,
  );
  const composer = screen.getByLabelText("Ask about this trip");
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: "What should we do?" } });
  fireEvent.keyDown(composer, { key: "Enter" });

  expect(await screen.findByText("Thinking through your trip…")).toBeVisible();
  expect(screen.getByRole("button", { name: "New chat" })).toBeDisabled();
  resolveFetch(
    Response.json({
      message: "Done",
      savedPlaceIds: [],
      suggestions: [],
      unresolvedPlaceNames: [],
      tripVersion: 1,
    }),
  );
  await waitFor(() => expect(screen.getByText("Done")).toBeVisible());
});
