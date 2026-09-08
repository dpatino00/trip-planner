"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const tokenPattern = /^[A-Za-z0-9_-]{22}$/;

export function TripEntry() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("trip-deleted")) {
      sessionStorage.removeItem("trip-deleted");
      queueMicrotask(() => setDeleted(true));
    }
  }, []);

  function openTrip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hash = link.includes("#") ? (link.split("#").at(-1) ?? "") : link;
    if (!tokenPattern.test(hash)) {
      setError("Paste a complete private trip link or its 22-character key.");
      return;
    }
    router.push(`/trip#${hash}`);
  }

  return (
    <main className="landing-shell">
      <section className="landing-copy">
        <p className="eyebrow">PRIVATE SHARED TRIPS</p>
        <h1>Keep every trip in one trusted place.</h1>
        <p className="lede">
          Sign in to your private catalog to create, find, share, or remove a
          trip. A private trip link still opens directly for collaborators.
        </p>
        <Link className="primary catalog-link" href="/trips">
          Open trip catalog
        </Link>
        {deleted ? (
          <p role="status" className="success">
            Trip deleted
          </p>
        ) : null}
      </section>
      <form className="setup-card" onSubmit={openTrip}>
        <h2>Open a private trip</h2>
        <label>
          Private link or key
          <input
            aria-label="Private trip link or key"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://…/trip#…"
            required
          />
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary">Open trip</button>
      </form>
    </main>
  );
}
