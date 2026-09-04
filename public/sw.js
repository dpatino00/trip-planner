const STATIC = "trip-static-v1";
const PUBLIC = "trip-public-v1";

self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    url.pathname === "/api/trip" ||
    url.pathname === "/api/conditions" ||
    request.method !== "GET"
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          void caches.open(PUBLIC).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/")),
        ),
    );
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            void caches.open(STATIC).then((cache) => cache.put(request, clone));
            return response;
          }),
      ),
    );
  }
});
