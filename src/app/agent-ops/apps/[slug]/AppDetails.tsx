"use client";

import { useState } from "react";
import { APP_STATUSES, type App, type AppStatus } from "@/lib/agentOps";
import styles from "../../agentOps.module.css";

// The app's own record: what it is, where its code lives, whether it is still
// being worked on. The slug is deliberately not editable — it is the URL.
export default function AppDetails({ app }: { app: App }) {
  const [draft, setDraft] = useState({
    name: app.name,
    repo: app.repo ?? "",
    live_url: app.live_url ?? "",
    summary: app.summary,
    status: app.status as AppStatus,
  });
  const [saved, setSaved] = useState(draft);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setState("saving");
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/apps/${app.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save it");
      const next = data.app as App;
      const applied = {
        name: next.name,
        repo: next.repo ?? "",
        live_url: next.live_url ?? "",
        summary: next.summary,
        status: next.status,
      };
      setDraft(applied);
      setSaved(applied);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save it");
      setState("idle");
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Details</h2>
          <p>
            What this project is and where it lives. The URL slug stays as it is, so a saved link keeps
            working through a rename.
          </p>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Repo</span>
        <input
          value={draft.repo}
          placeholder="owner/name"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => setDraft({ ...draft, repo: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Live URL</span>
        <input
          value={draft.live_url}
          placeholder="https://…"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => setDraft({ ...draft, live_url: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Status</span>
        <span className={styles.fieldHint}>Archived keeps the record without cluttering the list.</span>
        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value as AppStatus })}
        >
          {APP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Summary</span>
        <textarea
          rows={4}
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button
          type="button"
          onClick={save}
          disabled={state === "saving" || !dirty}
          className={state === "saved" ? styles.saved : ""}
        >
          {state === "saved" ? "Saved ✓" : state === "saving" ? "Saving…" : dirty ? "Save" : "No changes"}
        </button>
      </div>
    </div>
  );
}
