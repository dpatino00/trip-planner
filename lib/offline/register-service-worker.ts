// @spec PWA-UI-006, PWA-PROC-007
export async function registerServiceWorker(isFormDirty: () => boolean) {
  if (!("serviceWorker" in navigator)) return;

  if (process.env.NODE_ENV !== "production") {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const controlledByStaleWorker = navigator.serviceWorker.controller !== null;
    await Promise.allSettled(
      registrations.map((registration) => registration.unregister()),
    );
    if (controlledByStaleWorker && registrations.length > 0) {
      window.location.reload();
    }
    return;
  }

  const registration =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw-prod.js"));
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 2000);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  if (!navigator.onLine) return;

  const pagePath = `${location.pathname}${location.search}`;
  const pageResponse = await fetch(pagePath);
  if (pageResponse.ok) {
    const pageCache = await caches.open("public-v1");
    await pageCache.put(pagePath, pageResponse.clone());
  }
  const resources = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((value) => {
      const url = new URL(value);
      return (
        url.origin === location.origin && !url.pathname.startsWith("/api/")
      );
    });
  await Promise.allSettled([pagePath, ...resources].map((url) => fetch(url)));
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (
        worker.state === "installed" &&
        registration.waiting &&
        isFormDirty()
      ) {
        // Leave the update waiting; it will activate after a later navigation.
      }
    });
  });
}
