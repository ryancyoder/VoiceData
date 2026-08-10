"use client";

import { useState } from "react";
import { STAGES } from "@/lib/salesBoard";
import styles from "./settings.module.css";

// Per-stage default effort (hours a single deal is assumed to take). Feeds the
// Forecast when a deal has no per-deal estimate override.
export default function StageDefaultsEditor({ initialDefaults }: { initialDefaults: Record<string, number> }) {
  const [defaults, setDefaults] = useState<Record<string, number>>(initialDefaults);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/planning/stage-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaults }),
      });
      if (res.ok) {
        setState("saved");
        setTimeout(() => setState("idle"), 2000);
      } else {
        setState("idle");
      }
    } catch {
      setState("idle");
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Default effort per deal</h2>
          <p>
            Hours a single deal is assumed to take, by stage. The Forecast uses this when a deal has no estimate of its
            own; you can override any individual deal from the Forecast page.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className={state === "saved" ? styles.saved : ""}
        >
          {state === "saved" ? "Saved ✓" : state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      <div className={styles.grid}>
        {STAGES.map((s) => (
          <label key={s} className={styles.item}>
            <span>{s}</span>
            <div className={styles.inputWrap}>
              <input
                type="number"
                min={0}
                step={0.5}
                value={defaults[s] ?? 0}
                onChange={(e) => setDefaults({ ...defaults, [s]: Number(e.target.value) || 0 })}
              />
              <span className={styles.unit}>h</span>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
