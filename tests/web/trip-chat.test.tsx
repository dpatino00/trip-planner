import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { TripChat } from "@/components/chat/trip-chat";
import { makeTripV2, SHARE_TOKEN } from "./fixtures";

const suggestion = {
  name: "La Jolla Cove",
  summary: "Coastal views",
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
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "Try this coastal stop.",
      suggestions: [suggestion],
    }),
  );
  const onAddSuggestion = vi.fn().mockResolvedValue({ status: "saved" });
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={onAddSuggestion}
    />,
  );

  const composer = screen.getByLabelText("Ask about this trip");
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: "What should we do?" } });
  fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
  expect(composer).toHaveValue("What should we do?");
  fireEvent.keyDown(composer, { key: "Enter" });

  expect(await screen.findByText("Try this coastal stop.")).toBeVisible();
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
it("keeps messages readable but disables generation and confirmation offline", async () => {
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online={false}
      onAddSuggestion={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Ask about this trip")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByText(/Connect to ask/)).toBeVisible();
});

// @spec CHAT-UI-005, CHAT-BE-007
it("retains a suggestion after repeated conflicts so it can be retried", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      message: "Try this coastal stop.",
      suggestions: [suggestion],
    }),
  );
  const onAddSuggestion = vi.fn().mockResolvedValue({ status: "conflict" });
  render(
    <TripChat
      token={SHARE_TOKEN}
      trip={makeTripV2()}
      online
      onAddSuggestion={onAddSuggestion}
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
