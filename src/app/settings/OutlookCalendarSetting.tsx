"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./settings.module.css";

const OPACITY_DEFAULT = 100;
// Dragging the slider fires a change per pixel; only the pause at the end is
// worth a round trip.
const OPACITY_SAVE_DEBOUNCE_MS = 400;

// The published Outlook calendar .ics feed URL, overlaid read-only on the
// Calendar, plus how strongly that overlay is drawn. Stored server-side (the
// feed URL is a secret link) via /api/settings/outlook-ics.
export default function OutlookCalendarSetting() {
  const [url, setUrl] = useState("");
  const [opacity, setOpacity] = useState(OPACITY_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const opacityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/settings/outlook-ics")
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setUrl(d.url ?? "");
          setOpacity(typeof d.opacity === "number" ? d.opacity : OPACITY_DEFAULT);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  // Drop a debounced save that's still pending when the page goes away.
  useEffect(() => {
    return () => {
      if (opacityTimerRef.current) clearTimeout(opacityTimerRef.current);
    };
  }, []);

  // Sends only the named fields. The route leaves anything absent alone, so the
  // slider never has to restate the feed URL (and can't blank it by omission).
  async function post(patch: { url?: string; opacity?: number }) {
    setState("saving");
    setError("");
    try {
      const res = await fetch("/api/settings/outlook-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't save");
        setState("idle");
        return;
      }
      setUrl(data.url ?? "");
      if (typeof data.opacity === "number") setOpacity(data.opacity);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setError("Couldn't save");
      setState("idle");
    }
  }

  async function save() {
    await post({ url });
  }

  function handleOpacityChange(next: number) {
    setOpacity(next);
    if (opacityTimerRef.current) clearTimeout(opacityTimerRef.current);
    opacityTimerRef.current = setTimeout(() => {
      opacityTimerRef.current = null;
      void post({ opacity: next });
    }, OPACITY_SAVE_DEBOUNCE_MS);
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Outlook calendar overlay</h2>
          <p>
            Paste your <strong>published Outlook calendar</strong> link (the <code>.ics</code> feed) and your Outlook
            events show on the Calendar as a read-only overlay. In Outlook on the web: Settings → Calendar → Shared
            calendars → Publish a calendar → &quot;Can view all details&quot; → copy the ICS link. The feed updates on a
            delay, so the overlay can lag a bit.
          </p>
        </div>
        <button type="button" onClick={save} disabled={!loaded || state === "saving"} className={state === "saved" ? styles.saved : ""}>
          {state === "saved" ? "Saved ✓" : state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      <input
        type="url"
        inputMode="url"
        placeholder="https://outlook.office365.com/owa/calendar/…/reachcalendar.ics"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ width: "100%", padding: "8px 10px", boxSizing: "border-box" }}
      />
      {error && <p style={{ color: "var(--danger, #c0392b)", fontSize: "0.85rem", margin: "6px 0 0" }}>{error}</p>}
      {loaded && !url && (
        <p style={{ fontSize: "0.85rem", margin: "6px 0 0", opacity: 0.7 }}>
          Not connected yet — paste a feed URL and Save.
        </p>
      )}

      {/* Saves on its own (debounced), unlike the feed URL above — there's
          nothing to review before committing a slider. */}
      <div className={styles.sliderRow}>
        <label htmlFor="outlook-opacity">
          <strong>Overlay strength</strong>
          <span className={styles.toggleHint}>
            How strongly Outlook events are drawn over your own. Turn it down when the overlay competes
            with real events for attention.
          </span>
        </label>
        <div className={styles.sliderControl}>
          <input
            id="outlook-opacity"
            type="range"
            min={10}
            max={100}
            step={5}
            value={opacity}
            disabled={!loaded}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
          />
          <output htmlFor="outlook-opacity">{opacity}%</output>
        </div>
      </div>
    </div>
  );
}
