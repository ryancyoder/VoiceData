"use client";

import { useEffect, useState } from "react";
import styles from "./settings.module.css";

// The published Outlook calendar .ics feed URL, overlaid read-only on the
// Calendar. Stored server-side (it's a secret link) via /api/settings/outlook-ics.
export default function OutlookCalendarSetting() {
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/settings/outlook-ics")
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setUrl(d.url ?? "");
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setState("saving");
    setError("");
    try {
      const res = await fetch("/api/settings/outlook-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't save");
        setState("idle");
        return;
      }
      setUrl(data.url ?? "");
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setError("Couldn't save");
      setState("idle");
    }
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
    </div>
  );
}
