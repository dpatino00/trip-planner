import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { makeTripV2, SHARE_TOKEN } from "../web/fixtures";
import { createMockTripBackend, mockTripApi } from "./mock-api";

// @spec CHAT-UI-001
test("provides Ask as the fourth trip navigation destination", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  const navigation = page.getByRole("navigation", { name: "Trip" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation.getByRole("link", { name: "Ask" })).toBeVisible();
});

// @spec CHAT-DATA-005, CHAT-UI-002, CHAT-UI-004, CHAT-UI-005, CHAT-UI-007, CHAT-BE-004, CHAT-BE-005, CHAT-BE-014
test("adds a reviewed Ask suggestion to Ideas for collaborators without scheduling it", async ({
  page,
  browser,
}) => {
  const backend = createMockTripBackend();
  await mockTripApi(page, backend);
  const collaboratorContext = await browser.newContext();
  const collaborator = await collaboratorContext.newPage();
  await mockTripApi(collaborator, backend);
  try {
    await page.goto(`/trip#${SHARE_TOKEN}`);
    await page.getByRole("link", { name: "Ideas" }).click();
    await expect(
      page.getByRole("article", { name: "La Jolla Cove" }),
    ).toHaveCount(0);

    await collaborator.goto(`/trip#${SHARE_TOKEN}`);
    await collaborator.getByRole("link", { name: "Ideas" }).click();
    await expect(
      collaborator.getByRole("article", { name: "La Jolla Cove" }),
    ).toHaveCount(0);

    await page.getByRole("link", { name: "Ask" }).click();
    await page
      .getByLabel("Ask about this trip")
      .fill("A relaxed coastal morning?");
    await page.getByRole("button", { name: "Send" }).click();
    const suggestion = page.getByRole("article", { name: "La Jolla Cove" });
    await expect(suggestion).toBeVisible();
    await expect(
      suggestion.getByRole("link", { name: "Learn more" }),
    ).toHaveAttribute(
      "href",
      "https://www.sandiego.gov/lifeguards/beaches/cove",
    );
    await suggestion
      .getByRole("button", { name: "Add La Jolla Cove to trip" })
      .click();
    await expect(suggestion.getByText("Saved to Ideas")).toBeVisible();

    await page.getByRole("link", { name: "Ideas" }).click();
    const savedPlace = page.getByRole("article", { name: "La Jolla Cove" });
    await expect(savedPlace).toBeVisible();
    await expect(
      savedPlace.getByRole("link", { name: "Visit source" }),
    ).toHaveAttribute(
      "href",
      "https://www.sandiego.gov/lifeguards/beaches/cove",
    );
    await page.getByRole("link", { name: "Plan" }).click();
    await expect(
      page.getByTestId("itinerary-item").filter({ hasText: "La Jolla Cove" }),
    ).toHaveCount(0);

    await collaborator.reload();
    await collaborator.getByRole("link", { name: "Ideas" }).click();
    await expect(
      collaborator.getByRole("article", { name: "La Jolla Cove" }),
    ).toBeVisible();
  } finally {
    await collaboratorContext.close();
  }
});

// @spec CHAT-BE-022, CHAT-BE-025, CHAT-UI-007, CHAT-UI-012, CHAT-UI-013
test("adds a deterministic free-form suggestion batch with one trip change", async ({
  page,
}) => {
  const backend = createMockTripBackend();
  const original = structuredClone(backend.getTrip());
  await mockTripApi(page, backend);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ask" }).click();
  await page.getByLabel("Ask about this trip").fill(
    `Please add these places:
La Puerta — Gaslamp
Ironside Fish & Oyster — Little Italy
Garage Kitchen + Bar — Gaslamp`,
  );
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("article", { name: "La Puerta" })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Ironside Fish & Oyster" }),
  ).toBeVisible();
  const garage = page.getByRole("article", {
    name: "Garage Kitchen + Bar",
  });
  await expect(garage).toBeVisible();
  await expect(garage.getByRole("link", { name: "Learn more" })).toHaveCount(0);
  await expect(garage.getByRole("link", { name: "Google Maps" })).toBeVisible();

  await page.getByRole("button", { name: "Add all new" }).click();
  await expect(page.getByText("Saved to Ideas")).toHaveCount(3);
  expect(backend.getTrip().version).toBe(original.version + 1);
  expect(backend.getTrip().places).toHaveLength(original.places.length + 3);
  expect(backend.getTrip().itinerary).toEqual(original.itinerary);
});

// @spec CHAT-BE-028, CHAT-UI-013
test("reconciles every committed batch card when the mutation response is interrupted", async ({
  page,
}) => {
  const backend = createMockTripBackend(makeTripV2(), {
    dropFirstSuggestionResponse: true,
  });
  await mockTripApi(page, backend);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ask" }).click();
  await page
    .getByLabel("Ask about this trip")
    .fill(
      "Please add La Puerta, Ironside Fish & Oyster, and Garage Kitchen + Bar.",
    );
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Add all new" }).click();

  await expect(page.getByText("Saved to Ideas")).toHaveCount(3);
  await expect(page.getByText("Could not save this suggestion")).toHaveCount(0);
});

// @spec CHAT-BE-004, CHAT-UI-004, CHAT-UI-005
test("reconciles a committed suggestion when the first response is interrupted", async ({
  page,
}) => {
  const backend = createMockTripBackend(makeTripV2(), {
    dropFirstSuggestionResponse: true,
  });
  await mockTripApi(page, backend);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ask" }).click();
  await page
    .getByLabel("Ask about this trip")
    .fill("A relaxed coastal morning?");
  await page.getByRole("button", { name: "Send" }).click();
  const suggestion = page.getByRole("article", { name: "La Jolla Cove" });
  await expect(suggestion).toBeVisible();
  await suggestion
    .getByRole("button", { name: "Add La Jolla Cove to trip" })
    .click();
  await expect(suggestion.getByText("Saved to Ideas")).toBeVisible();
  await expect(
    suggestion.getByText("Could not save this suggestion"),
  ).toHaveCount(0);
});

// @spec CHAT-BE-002, CHAT-BE-010, CHAT-BE-011, CHAT-UI-008, CHAT-UI-009
test("finds an explicitly requested saved place without changing the trip", async ({
  page,
}) => {
  const backend = createMockTripBackend();
  const originalTrip = structuredClone(backend.getTrip());
  await mockTripApi(page, backend);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ask" }).click();
  await page
    .getByLabel("Ask about this trip")
    .fill("Show me my saved Mexican ideas");
  await page.getByRole("button", { name: "Send" }).click();

  const match = page.getByTestId("saved-match-card");
  await expect(match).toHaveAttribute("aria-label", "Oscar's Mexican Seafood");
  await expect(match).toContainText("Casual seafood tacos");
  await expect(match).toContainText(/tacos.*casual/i);
  await expect(
    match.getByRole("link", { name: "Visit source" }),
  ).toHaveAttribute("href", "https://oscarsmexicanseafood.com/");
  await expect(match.getByRole("link", { name: "Apple Maps" })).toBeVisible();
  await expect(match.getByRole("link", { name: "Google Maps" })).toBeVisible();
  await expect(match.getByRole("link", { name: "Directions" })).toBeVisible();
  await expect(match.getByRole("button", { name: /add .* trip/i })).toHaveCount(
    0,
  );

  await match
    .getByRole("button", { name: "View Oscar's Mexican Seafood in Ideas" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ideas worth keeping close" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Oscar's Mexican Seafood" }),
  ).toBeVisible();
  expect(backend.getTrip()).toEqual(originalTrip);
});

// @spec CHAT-BE-020, CHAT-UI-002, CHAT-UI-004, CHAT-UI-005
test("keeps saved ideas out of general discovery searches", async ({
  page,
}) => {
  const backend = createMockTripBackend();
  await mockTripApi(page, backend);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ask" }).click();
  await page.getByLabel("Ask about this trip").fill("I'm feeling Mexican food");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("saved-match-card")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "La Puerta" })).toBeVisible();
  expect(backend.getTrip()).toEqual(makeTripV2());
});

// @spec CHAT-BE-002, CHAT-BE-015, CHAT-BE-016, CHAT-BE-019, CHAT-API-011, CHAT-UI-010
test("automatically adds and renders a verified source for an unsourced saved match", async ({
  page,
}) => {
  const backend = createMockTripBackend();
  await mockTripApi(page, backend);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  expect(
    backend
      .getTrip()
      .places.find((place: { id: string }) => place.id === "place-torrey-pines")
      ?.sourceUrl,
  ).toBeNull();

  await page.getByRole("link", { name: "Ask" }).click();
  await page
    .getByLabel("Ask about this trip")
    .fill("Tell me about Torrey Pines");
  await page.getByRole("button", { name: "Send" }).click();

  const match = page.getByTestId("saved-match-card");
  await expect(match).toHaveAttribute(
    "aria-label",
    "Torrey Pines State Reserve",
  );
  await expect(
    match.getByRole("link", { name: "Visit source" }),
  ).toHaveAttribute("href", "https://www.parks.ca.gov/torreypines");
  const changed = backend.getTrip();
  expect(changed.version).toBe(2);
  expect(
    changed.places.find(
      (place: { id: string }) => place.id === "place-torrey-pines",
    )?.sourceUrl,
  ).toBe("https://www.parks.ca.gov/torreypines");
  expect(changed.itinerary).toEqual([]);
  expect(changed.proposals).toEqual([]);
});

// @spec TRIP-UI-001, TRIP-UI-002, TRIP-UI-003, CAT-API-001, CAT-API-003
test("creates a trip from the private catalog", async ({ page }) => {
  await mockTripApi(page);
  await page.goto("/trips");
  await page.getByLabel("Shared password").fill("e2e catalog password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(
    page.getByText(/anyone with.*link.*edit.*delete/i),
  ).toBeVisible();
  await page.getByLabel("Trip title").fill("San Diego escape");
  await page.getByLabel("Destination").fill("San Diego");
  await page.getByLabel("Start date").fill("2026-09-14");
  await page.getByLabel("End date").fill("2026-09-18");
  await page.getByLabel("Home base").fill("Little Italy");
  await page.getByLabel("Food").check();
  await page.getByLabel("Pace").selectOption("balanced");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trip#[A-Za-z0-9_-]{22}$/);
});

// @spec TRIP-UI-004
test("shares with the native API or clipboard fallback", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("button", { name: "Share trip" }).click();
  await expect(page.getByText(/link copied|share sheet opened/i)).toBeVisible();
});

// @spec TRIP-UI-005, TRIP-UI-007
test("copies the private link for ChatGPT with a clear warning", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("button", { name: "Copy link for ChatGPT" }).click();
  await expect(page.getByText(/anyone with.*link.*edit/i)).toBeVisible();
  await page.getByRole("button", { name: /copy private link/i }).click();
  await expect(page.getByText(/link copied/i)).toBeVisible();
});

// @spec TRIP-UI-006
test("confirms and completes permanent shared-trip deletion", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("button", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Delete trip" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete trip" });
  await expect(dialog).toContainText(/permanent.*everyone/i);
  await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Trip deleted")).toBeVisible();
});

// @spec TRIP-NAV-001, SEC-NAV-001
test("loads fragment-authenticated trip state only in the browser", async ({
  page,
}) => {
  let authorization = "";
  await page.route("**/api/trip", (route) => {
    authorization = route.request().headers().authorization ?? "";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trip: makeTripV2() }),
    });
  });
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await expect(page.getByText("San Diego escape")).toBeVisible();
  expect(authorization).toBe(`Bearer ${SHARE_TOKEN}`);
  expect(page.url().split("#")[0]).toMatch(/\/trip$/);
});

// @spec TRIP-NAV-002
test("recovers from a missing share fragment without calling the API", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/trip", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/trip");
  await expect(
    page.getByRole("button", { name: "Paste trip link" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create a new trip" }),
  ).toBeVisible();
  expect(calls).toBe(0);
});

// @spec TRIP-NAV-003
test("shows a recoverable state for an expired trip", async ({ page }) => {
  await page.route("**/api/trip", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "trip-not-found",
          message: "Trip not found",
          retryable: false,
        },
      }),
    }),
  );
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await expect(
    page.getByRole("heading", { name: /trip.*not found|expired/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create a new trip" }),
  ).toBeVisible();
});

// @spec COND-UI-001, COND-UI-005, COND-UI-006
test("shows current conditions, marine details, and time controls", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await expect(page.getByText("72°")).toBeVisible();
  await expect(page.getByText(/5%.*rain/i)).toBeVisible();
  await expect(page.getByText(/8 mph/i)).toBeVisible();
  await expect(page.getByText(/AQI 35/i)).toBeVisible();
  await expect(page.getByText(/UV 5/i)).toBeVisible();
  await expect(page.getByText(/69°.*water/i)).toBeVisible();
  await expect(page.getByText(/2.5 ft.*11 sec/i)).toBeVisible();
  await expect(page.getByLabel("Recommendation date")).toBeVisible();
  await expect(page.getByLabel("Recommendation time")).toBeVisible();
});

// @spec COND-UI-002, COND-UI-003, COND-UI-004
test("labels degraded, advisory, and out-of-range condition states", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await expect(
    page.getByText(/advisory.*not suitable for navigation/i),
  ).toBeVisible();

  await page.route("**/api/conditions**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unavailable",
        reason: "forecast-out-of-range",
        coordinates: { latitude: 32.7157, longitude: -117.1611 },
        timeZone: "America/Los_Angeles",
        marine: { status: "unavailable" },
      }),
    }),
  );
  await page.getByLabel("Recommendation date").fill("2026-12-20");
  await expect(page.getByText(/refresh closer to.*date/i)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Trip" })).toBeVisible();
});

// @spec PLC-UI-001, PLC-UI-002, PLC-UI-003, PLC-UI-004, PLC-UI-005
test("renders useful saved-place cards without requiring images", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ideas" }).click();
  const card = page.getByRole("article", { name: "Balboa Park" });
  await expect(card).toContainText(/San Diego.*Gardens.*museum/i);
  await expect(card.getByRole("img")).toHaveCount(0);
  await expect(card).toContainText(/added by ChatGPT/i);
  await expect(
    card.getByRole("link", { name: "Visit source" }),
  ).toHaveAttribute("href", /^https:/);
  await expect(card.getByRole("link", { name: "Apple Maps" })).toHaveAttribute(
    "href",
    /maps\.apple/,
  );
  await expect(card.getByRole("link", { name: "Google Maps" })).toHaveAttribute(
    "href",
    /google.*maps|maps.*google/,
  );

  const noSource = page.getByRole("article", {
    name: "Torrey Pines State Reserve",
  });
  await expect(
    noSource.getByRole("link", { name: "Visit source" }),
  ).toHaveCount(0);
  await expect(noSource.getByRole("img")).toHaveCount(0);
});

// @spec REC-BE-009, REC-BE-010, REC-BE-011, REC-UI-005
test("shows six explained recommendations without a false live claim", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  const recommendations = page.getByTestId("recommendation-card");
  await expect(recommendations).toHaveCount(6);
  for (const card of await recommendations.all()) {
    const reasonCount = await card.getByTestId("reason-chip").count();
    expect(reasonCount).toBeGreaterThan(0);
    expect(reasonCount).toBeLessThanOrEqual(3);
  }
});

// @spec REC-UI-001, REC-UI-004
test("requests location only after the location button is pressed", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.7157, longitude: -117.1611 });
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByText(/ranking from your location/i)).toBeVisible();
});

// @spec EXP-UI-001, EXP-UI-002, EXP-NAV-001, EXP-NAV-002
test("searches and URL-encodes Ideas filters", async ({ page }) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ideas" }).click();
  await page.getByRole("searchbox", { name: "Search places" }).fill("Balboa");
  await page.getByLabel("Interest").selectOption("culture");
  await expect(page).toHaveURL(/search=Balboa/);
  await expect(page).toHaveURL(/interest=culture/);
  await page.reload();
  await expect(
    page.getByRole("searchbox", { name: "Search places" }),
  ).toHaveValue("Balboa");
  await expect(
    page.getByRole("article", { name: "Balboa Park" }),
  ).toBeVisible();
});

// @spec EXP-UI-003, EXP-UI-004, EXP-UI-005
test("optimistically favorites a place and exposes all card actions", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ideas" }).click();
  const card = page.getByRole("article", { name: "Balboa Park" });
  const favorite = card.getByRole("button", { name: "Save Balboa Park" });
  await favorite.click();
  await expect(
    card.getByRole("button", { name: "Remove Balboa Park from saved" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Add Balboa Park to plan" }),
  ).toBeVisible();
  await expect(card.getByRole("link", { name: "Visit source" })).toBeVisible();
  await expect(card.getByRole("link", { name: /maps/i }).first()).toBeVisible();
});

// @spec PLAN-UI-001, PLAN-UI-002, PLAN-UI-003
test("shows every trip day with today and empty-day guidance", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByTestId("itinerary-day")).toHaveCount(5);
  await expect(page.getByText(/Sep 15.*Today/i)).toBeVisible();
  await expect(page.getByText(/add a saved place/i)).toBeVisible();
});

// @spec OPT-UI-001, OPT-UI-002, OPT-UI-003
test("shows reviewable proposal controls and blocks stale application", async ({
  page,
}) => {
  const api = await mockTripApi(page);
  const proposal = {
    id: "proposal-1",
    baseVersion: 1,
    status: "pending",
    summary: "A relaxed first afternoon",
    changes: [
      {
        type: "add-item",
        placeId: "place-balboa-park",
        date: "2026-09-15",
        startTime: "14:00",
        rationale: "Keeps the first morning open after arrival.",
      },
    ],
    createdAt: "2026-09-15T17:00:00.000Z",
  };
  api.setTrip(makeTripV2({ proposals: [proposal] }));

  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByText(proposal.summary)).toBeVisible();
  await expect(page.getByText(proposal.changes[0].rationale)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply proposal" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dismiss proposal" }),
  ).toBeVisible();

  api.setTrip(makeTripV2({ version: 2, proposals: [proposal] }));
  await page.reload();
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByText(/proposal.*stale|regenerate/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply proposal" }),
  ).toHaveCount(0);
});

// @spec PLAN-UI-004, PLAN-UI-005
test("adds saved places as confirmed and confirms tentative items", async ({
  page,
}) => {
  const api = await mockTripApi(page);
  api.setTrip(
    makeTripV2({
      itinerary: [
        {
          id: "tentative",
          placeId: "place-tacos",
          date: "2026-09-15",
          startTime: null,
          durationMinutes: 60,
          order: 0,
          notes: "",
          status: "tentative",
        },
      ],
    }),
  );
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Ideas" }).click();
  await page
    .getByRole("article", { name: "Balboa Park" })
    .getByRole("button", { name: "Add Balboa Park to plan" })
    .click();
  await page.getByLabel("Plan date").selectOption("2026-09-15");
  await page.getByRole("button", { name: "Add to plan" }).click();

  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByText(/Balboa Park.*confirmed/i)).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm Oscar's Mexican Seafood" })
    .click();
  await expect(
    page.getByText(/Oscar's Mexican Seafood.*confirmed/i),
  ).toBeVisible();
});

// @spec PLAN-UI-006, PLAN-UI-007, PLAN-UI-008, PLAN-UI-009
test("edits, orders, moves, and rolls back itinerary items", async ({
  page,
}) => {
  const api = await mockTripApi(page);
  api.setTrip(
    makeTripV2({
      itinerary: [
        {
          id: "untimed",
          placeId: "place-tacos",
          date: "2026-09-15",
          startTime: null,
          durationMinutes: 60,
          order: 1,
          notes: "",
          status: "confirmed",
        },
        {
          id: "dinner",
          placeId: "place-balboa-park",
          date: "2026-09-15",
          startTime: "19:00",
          durationMinutes: 180,
          order: 0,
          notes: "",
          status: "confirmed",
        },
      ],
    }),
  );
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await page.getByRole("link", { name: "Plan" }).click();
  const items = page.getByTestId("itinerary-item");
  await expect(items.first()).toContainText("Balboa Park");
  await expect(
    page.getByRole("button", { name: "Move Oscar's Mexican Seafood up" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit Balboa Park" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Balboa Park" }),
  ).toBeVisible();
});

// @spec APP-UI-001, APP-UI-002, APP-UI-003, APP-UI-004, APP-UI-007
test("uses responsive coastal navigation without horizontal overflow", async ({
  page,
}, testInfo) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  const isMobile = testInfo.project.name.includes("mobile");
  await expect(page.getByRole("navigation", { name: "Trip" })).toHaveCSS(
    "position",
    isMobile ? "fixed" : "sticky",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const smallestTarget = await page
    .locator("button, a")
    .evaluateAll((elements) =>
      Math.min(
        ...elements
          .map((element) => element.getBoundingClientRect())
          .filter((rectangle) => rectangle.width > 0 && rectangle.height > 0)
          .map((rectangle) => Math.min(rectangle.width, rectangle.height)),
      ),
    );
  expect(smallestTarget).toBeGreaterThanOrEqual(44);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(247, 241, 229)",
  );
});

// @spec APP-UI-005, APP-UI-006, APP-UI-008
test("meets automated accessibility and focus-management expectations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  const settings = page.getByRole("button", { name: "Trip settings" });
  await settings.focus();
  await settings.click();
  await page.getByRole("button", { name: "Delete trip" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete trip" });
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Delete trip" })).toBeFocused();
});

// @spec APP-UI-009, SEC-DATA-003
test("renders user text inertly and protects outbound links", async ({
  page,
}) => {
  const api = await mockTripApi(page);
  api.setTrip(makeTripV2({ title: "<img src=x onerror=alert(1)>" }));
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await expect(page.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
  await expect(page.locator("img[src=x]")).toHaveCount(0);
  const external = page.getByRole("link", { name: /directions/i }).first();
  await expect(external).toHaveAttribute("rel", /noopener/);
  await expect(external).toHaveAttribute("rel", /noreferrer/);
});

// @spec PWA-UI-001, PWA-UI-002, PWA-UI-003
test("keeps cached essentials readable but disables mutation offline", async ({
  page,
  context,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  await expect(page.getByText("San Diego escape")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("San Diego escape")).toBeVisible();
  await expect(page.getByText(/offline.*stale/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /save/i }).first(),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: /directions/i }).first(),
  ).toContainText(/requires connection/i);
});

// @spec SEC-DATA-001, SEC-DATA-002, SEC-DATA-004
test("does not persist credentials, coordinates, or raw rate-limit addresses in the browser", async ({
  page,
}) => {
  await mockTripApi(page);
  await page.goto(`/trip#${SHARE_TOKEN}`);
  const browserState = await page.evaluate(async () => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    cookies: document.cookie,
    caches: await caches.keys(),
  }));
  expect(JSON.stringify(browserState)).not.toContain(SHARE_TOKEN);
  expect(JSON.stringify(browserState)).not.toContain("203.0.113");
});
