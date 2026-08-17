"use client";

import { useEffect, useState } from "react";
import styles from "./settings.module.css";

type ViewOptions = { hoverPropertyPhoto: boolean; hoverPropertyPhotoWide: boolean };

// Sales Board view options. Checkboxes save on change rather than behind a
// Save button — there's nothing to review before committing a toggle, and the
// board picks the new values up on its next load.
export default function SalesBoardViewSetting() {
  const [options, setOptions] = useState<ViewOptions>({
    hoverPropertyPhoto: false,
    hoverPropertyPhotoWide: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/settings/sales-board-view")
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setOptions({
            hoverPropertyPhoto: !!d.hoverPropertyPhoto,
            hoverPropertyPhotoWide: !!d.hoverPropertyPhotoWide,
          });
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  async function save(patch: Partial<ViewOptions>) {
    // Move the checkbox immediately, then roll back if the save fails — a
    // toggle that lags a round trip feels broken.
    const previous = options;
    setOptions({ ...options, ...patch });
    setState("saving");
    setError("");
    try {
      const res = await fetch("/api/settings/sales-board-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setOptions(previous);
        setError(data.error || "Couldn't save");
        setState("idle");
        return;
      }
      setOptions({
        hoverPropertyPhoto: !!data.hoverPropertyPhoto,
        hoverPropertyPhotoWide: !!data.hoverPropertyPhotoWide,
      });
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setOptions(previous);
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
          checked={options.hoverPropertyPhoto}
          disabled={!loaded}
          onChange={(e) => save({ hoverPropertyPhoto: e.target.checked })}
        />
        <span>
          <strong>Show key property photo on hover</strong>
          <span className={styles.toggleHint}>
            Hovering a deal card shows that property&apos;s key photo — the album cover set in the photo
            gallery. Deals whose property has no key photo set show nothing. Pointer only, so it never
            interferes with touch.
          </span>
        </span>
      </label>

      {/* Sub-option: it only changes where the preview above is drawn, so it's
          indented under it and inert while the parent option is off. */}
      <label className={`${styles.toggleRow} ${styles.toggleSub}`}>
        <input
          type="checkbox"
          checked={options.hoverPropertyPhotoWide}
          disabled={!loaded || !options.hoverPropertyPhoto}
          onChange={(e) => save({ hoverPropertyPhotoWide: e.target.checked })}
        />
        <span>
          <strong>Wide screen</strong>
          <span className={styles.toggleHint}>
            Show the photo in a full-height pane after the Paid in Full column instead of a small box
            beside the card. The pane keeps showing the last card you hovered. Best on a display wide
            enough to fit the whole board — on a narrower screen the pane sits off to the right and you
            have to scroll to it.
          </span>
        </span>
      </label>

      {error && <p className={styles.toggleError}>{error}</p>}
    </div>
  );
}
