"use client";

import { useEffect, useState } from "react";
import styles from "./settings.module.css";

// Sales Board view options. A checkbox saves on change rather than behind a
// Save button — there's nothing to review before committing a toggle, and the
// board picks the new value up on its next load.
export default function SalesBoardViewSetting() {
  const [hoverPropertyPhoto, setHoverPropertyPhoto] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/settings/sales-board-view")
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setHoverPropertyPhoto(!!d.hoverPropertyPhoto);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  async function save(next: boolean) {
    // Move the checkbox immediately, then roll back if the save fails — a
    // toggle that lags a round trip feels broken.
    const previous = hoverPropertyPhoto;
    setHoverPropertyPhoto(next);
    setState("saving");
    setError("");
    try {
      const res = await fetch("/api/settings/sales-board-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoverPropertyPhoto: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setHoverPropertyPhoto(previous);
        setError(data.error || "Couldn't save");
        setState("idle");
        return;
      }
      setHoverPropertyPhoto(!!data.hoverPropertyPhoto);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setHoverPropertyPhoto(previous);
      setError("Couldn't save");
      setState("idle");
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Sales Board view</h2>
          <p>How deal cards are displayed on the board.</p>
        </div>
        {state !== "idle" && (
          <span className={styles.saveNote}>{state === "saved" ? "Saved ✓" : "Saving…"}</span>
        )}
      </div>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={hoverPropertyPhoto}
          disabled={!loaded}
          onChange={(e) => save(e.target.checked)}
        />
        <span>
          <strong>Show key property photo on hover</strong>
          <span className={styles.toggleHint}>
            Hovering a deal card pops up that property&apos;s key photo — the album cover set in the photo
            gallery. Deals whose property has no key photo set show nothing. Pointer only, so it never
            interferes with touch.
          </span>
        </span>
      </label>

      {error && <p className={styles.toggleError}>{error}</p>}
    </div>
  );
}
