"use client";

import { useEffect, useState } from "react";
import { saveTileMode } from "@/lib/useTileMode";
import styles from "./settings.module.css";

// App-wide Tile mode toggle. Saves on change (no Save button — there's nothing
// to review before committing a toggle). The launcher and nav pick the new
// value up live via the window event saveTileMode() dispatches.
export default function TileModeSetting() {
  const [on, setOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/settings/tile-mode")
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setOn(!!d.tileMode);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  async function toggle(next: boolean) {
    const previous = on;
    setOn(next);
    setState("saving");
    setError("");
    try {
      const confirmed = await saveTileMode(next);
      setOn(confirmed);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setOn(previous);
      setError(err instanceof Error ? err.message : "Couldn't save");
      setState("idle");
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Tile mode</h2>
          <p>Navigate the app by drilling through full-screen tiles.</p>
        </div>
        {state !== "idle" && (
          <span className={styles.saveNote}>{state === "saved" ? "Saved ✓" : "Saving…"}</span>
        )}
      </div>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={on}
          disabled={!loaded}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          <strong>Turn on Tile mode</strong>
          <span className={styles.toggleHint}>
            The home page becomes a Launch Pad of big tiles — one per view. Tapping a tile opens that
            view; the Sales Board tile drills further, into a screen of tiles for each stage, then a
            screen of tiles for each deal in that stage. Tapping a deal opens it. Designed for
            touch-first, at-a-glance navigation. Leave it off for the normal menu-driven layout.
          </span>
        </span>
      </label>

      {error && <p className={styles.toggleError}>{error}</p>}
    </div>
  );
}
