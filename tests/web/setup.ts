import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});
