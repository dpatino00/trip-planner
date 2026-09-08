"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Onboarding } from "@/components/onboarding";

interface CatalogTrip {
  id: string;
  token: string | null;
  title: string;
  destinationName: string;
  startDate: string;
  endDate: string;
  expiresAt: string;
  status: "active" | "expired" | "unavailable";
}

function privateUrl(token: string) {
  return `${window.location.origin}/trip#${token}`;
}

export function TripCatalog() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [trips, setTrips] = useState<CatalogTrip[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CatalogTrip | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [importLink, setImportLink] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/catalog/trips", { cache: "no-store" });
    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error?.message ?? "Could not load trips");
    setAuthenticated(true);
    setTrips(data.trips);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load().catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Could not load trips",
        ),
      );
    });
  }, [load]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Could not sign in");
      setPassword("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/catalog/session", { method: "DELETE" });
    setTrips([]);
    setAuthenticated(false);
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(privateUrl(token));
    } catch {
      setError("Could not copy the private link.");
    }
  }

  async function importTrip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/trips/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link: importLink }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Could not import trip");
      setImportLink("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not import trip",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting || confirmation !== "DELETE") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/catalog/trips/${deleting.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message ?? "Could not delete the trip");
      }
      setTrips((current) => current.filter((trip) => trip.id !== deleting.id));
      setDeleting(null);
      setConfirmation("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete the trip",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <main className="landing-shell">
        <section className="landing-copy">
          <p className="eyebrow">PRIVATE TRIP CATALOG</p>
          <h1>Your shared trips, in one place.</h1>
          <p className="lede">
            Sign in with the shared password to manage trips.
          </p>
        </section>
        <form className="setup-card" onSubmit={signIn}>
          <h2>Sign in</h2>
          <label>
            Shared password
            <input
              aria-label="Shared password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  if (creating) {
    return (
      <Onboarding
        endpoint="/api/catalog/trips"
        onCreated={(token) => {
          setCreating(false);
          void load();
          router.push(`/trip#${token}`);
        }}
      />
    );
  }

  return (
    <main className="catalog-shell">
      <header className="catalog-header">
        <div>
          <p className="eyebrow">PRIVATE TRIP CATALOG</p>
          <h1>Your trips</h1>
          <p className="lede">
            Open, copy, or permanently remove every trip created here.
          </p>
        </div>
        <div className="header-actions">
          <button onClick={() => setCreating(true)}>Create trip</button>
          <button onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <form className="catalog-import" onSubmit={importTrip}>
        <label>
          Import an existing private trip
          <input
            value={importLink}
            onChange={(event) => setImportLink(event.target.value)}
            placeholder="Paste its private link or key"
            required
          />
        </label>
        <button disabled={busy}>Import trip</button>
      </form>
      {trips.length === 0 ? (
        <section className="setup-card">
          <h2>No trips yet</h2>
          <p>Create the first shared trip from this catalog.</p>
        </section>
      ) : (
        <section className="catalog-grid" aria-label="Your trips">
          {trips.map((trip) => (
            <article className="catalog-card" key={trip.id}>
              <p className="eyebrow">
                {trip.status === "active"
                  ? "ACTIVE"
                  : trip.status === "expired"
                    ? "EXPIRED"
                    : "NEEDS RE-IMPORT"}
              </p>
              <h2>{trip.title}</h2>
              <p>{trip.destinationName}</p>
              <p>
                {trip.startDate} – {trip.endDate}
              </p>
              <div className="catalog-actions">
                {trip.token ? (
                  <>
                    <a className="primary" href={`/trip#${trip.token}`}>
                      Open trip
                    </a>
                    <button onClick={() => void copy(trip.token!)}>
                      Copy link
                    </button>
                  </>
                ) : (
                  <p className="catalog-warning">
                    Import its original private link to restore access, or
                    delete this record.
                  </p>
                )}
                <button className="danger" onClick={() => setDeleting(trip)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {deleting ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-delete-title"
          >
            <h2 id="catalog-delete-title">Delete {deleting.title}?</h2>
            <p>
              This permanently removes the shared trip and its private link for
              everyone.
            </p>
            <label>
              Type DELETE to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setDeleting(null);
                  setConfirmation("");
                }}
              >
                Cancel
              </button>
              <button
                className="danger"
                disabled={confirmation !== "DELETE" || busy}
                onClick={() => void remove()}
              >
                Delete permanently
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
