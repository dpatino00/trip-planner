/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[];
  }
}
declare const self: ServiceWorkerGlobalScope;

// @spec PWA-PROC-002, PWA-PROC-003, PWA-PROC-004
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        request.destination === "image" ||
        url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "static-v1",
        plugins: [new ExpirationPlugin({ maxEntries: 100 })],
      }),
    },
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" ||
        (process.env.NEXT_PUBLIC_E2E !== "1" &&
          url.pathname === "/api/conditions"),
      handler: new NetworkFirst({
        cacheName: "public-v1",
        networkTimeoutSeconds: 4,
      }),
    },
  ],
});

serwist.addEventListeners();
