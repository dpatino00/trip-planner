import { tripDocumentSchema } from "@/lib/trips/schema";

const databaseName = "trip-companion-v1";
const storeName = "trips";
async function keyFor(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, key: string) => IDBRequest,
  token: string,
) {
  const database = await openDatabase();
  const key = await keyFor(token);
  return await new Promise<unknown>((resolve, reject) => {
    const request = action(
      database.transaction(storeName, mode).objectStore(storeName),
      key,
    );
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

// @spec PWA-DATA-001, PWA-DATA-002, PWA-UI-004, SEC-DATA-001
export async function saveTripSnapshot(token: string, trip: unknown) {
  try {
    await transact(
      "readwrite",
      (store, key) =>
        store.put(
          { schemaVersion: 1, trip, savedAt: new Date().toISOString() },
          key,
        ),
      token,
    );
    return true;
  } catch {
    return false;
  }
}
export async function loadTripSnapshot(token: string) {
  try {
    const snapshot = (await transact(
      "readonly",
      (store, key) => store.get(key),
      token,
    )) as { schemaVersion: number; trip: unknown } | undefined;
    if (
      !snapshot ||
      snapshot.schemaVersion !== 1 ||
      !tripDocumentSchema.safeParse(snapshot.trip).success
    ) {
      if (snapshot) await removeTripSnapshot(token);
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}
export async function removeTripSnapshot(token: string) {
  try {
    await transact("readwrite", (store, key) => store.delete(key), token);
  } catch {
    /* Persistence is optional. */
  }
}
