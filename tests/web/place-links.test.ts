// @vitest-environment node

import { expect, it } from "vitest";

import { createPlaceMapLinks } from "@/lib/places/links";
import { makeSavedPlace } from "./fixtures";

// @spec PLC-BE-005
it("derives safe Apple and Google Maps destinations for every place", () => {
  const links = createPlaceMapLinks(
    makeSavedPlace({ sourceUrl: null, coordinates: null }),
  );

  expect(links.apple).toMatch(/^https:\/\/maps\.apple\.com\//);
  expect(links.google).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//);
  expect(decodeURIComponent(links.apple)).toContain("Balboa Park");
  expect(decodeURIComponent(links.google)).toContain("San Diego, CA");
});
