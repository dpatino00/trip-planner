"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { tripCopy } from "@/lib/ui/copy";

// @spec TRIP-UI-001, TRIP-UI-002, TRIP-UI-003
interface OnboardingProps {
  endpoint?: string;
  onCreated?: (token: string) => void;
}

export function Onboarding({
  endpoint = "/api/trip",
  onCreated,
}: OnboardingProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem("trip-deleted")) {
      sessionStorage.removeItem("trip-deleted");
      queueMicrotask(() => setDeleted(true));
    }
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const preferences = {
      interests: form.getAll("interests"),
      maximumCost: Number(form.get("maximumCost")),
      pace: form.get("pace"),
      mobility: form.get("mobility"),
      notes: form.get("notes") ?? "",
    };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          startDate: form.get("startDate"),
          endDate: form.get("endDate"),
          destination: {
            name: form.get("destination"),
            locality: null,
            countryCode: null,
            coordinates: null,
            timeZone: null,
          },
          homeBase: form.get("homeBase")
            ? { label: form.get("homeBase"), coordinates: null }
            : null,
          preferences,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "Could not create the trip");
      if (onCreated) onCreated(data.token);
      else router.push(`/trip#${data.token}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create the trip",
      );
      setBusy(false);
    }
  }

  return (
    <main className="landing-shell">
      <section className="landing-copy">
        <p className="eyebrow">{tripCopy.onboarding.eyebrow}</p>
        <h1>{tripCopy.onboarding.heading}</h1>
        <p className="lede">
          Save discoveries from any conversation, see what fits today, and shape
          a flexible itinerary together.
        </p>
        <div className="trust-note">
          <strong>Your link is the key.</strong> Anyone with this private link
          can view, edit, and delete the trip. Share it only with people you
          trust.
        </div>
        {deleted && (
          <p role="status" className="success">
            Trip deleted
          </p>
        )}
      </section>
      <form className="setup-card" onSubmit={submit}>
        <h2>{tripCopy.onboarding.formHeading}</h2>
        <label>
          Trip title
          <input
            name="title"
            defaultValue="Our next adventure"
            maxLength={80}
            required
          />
        </label>
        <label>
          Destination
          <input
            name="destination"
            placeholder="Kyoto, San Diego, anywhere…"
            required
          />
        </label>
        <div className="field-pair">
          <label>
            Start date
            <input name="startDate" type="date" required />
          </label>
          <label>
            End date
            <input name="endDate" type="date" required />
          </label>
        </div>
        <label>
          Home base
          <input name="homeBase" placeholder="Optional neighborhood or hotel" />
        </label>
        <fieldset>
          <legend>Interests</legend>
          <div className="choice-grid">
            {["outdoors", "food", "culture", "history", "wildlife"].map(
              (interest) => (
                <label className="check" key={interest}>
                  <input
                    type="checkbox"
                    name="interests"
                    value={interest}
                    aria-label={interest[0].toUpperCase() + interest.slice(1)}
                    defaultChecked={["outdoors", "food", "culture"].includes(
                      interest,
                    )}
                  />
                  {interest}
                </label>
              ),
            )}
          </div>
        </fieldset>
        <div className="field-pair">
          <label>
            Maximum cost
            <select name="maximumCost" defaultValue="2">
              <option value="0">Free</option>
              <option value="1">$</option>
              <option value="2">$$</option>
              <option value="3">$$$</option>
            </select>
          </label>
          <label>
            Pace
            <select name="pace" defaultValue="balanced">
              <option value="relaxed">Relaxed</option>
              <option value="balanced">Balanced</option>
              <option value="full">Full</option>
            </select>
          </label>
        </div>
        <label>
          Mobility preference
          <select name="mobility" defaultValue="standard">
            <option value="standard">Standard</option>
            <option value="low-walking">Low walking</option>
            <option value="step-free">Step-free</option>
          </select>
        </label>
        <label>
          Anything else?
          <textarea
            name="notes"
            maxLength={1000}
            placeholder="Slow mornings, one big activity a day…"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create trip"}
        </button>
      </form>
    </main>
  );
}
