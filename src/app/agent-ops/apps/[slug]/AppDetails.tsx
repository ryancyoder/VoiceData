"use client";

import { useState } from "react";
import { APP_STATUSES, type App, type AppStatus } from "@/lib/agentOps";
import AppIcon from "../AppIcon";
import styles from "../../agentOps.module.css";

// The app's own record: what it is, where its code lives, whether it is still
// being worked on. The slug is deliberately not editable — it is the URL.
export default function AppDetails({ app: initialApp }: { app: App }) {
  const [app, setApp] = useState(initialApp);
  const [iconState, setIconState] = useState<"idle" | "fetching">("idle");
  const [iconUrl, setIconUrl] = useState("");
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

  // The home-screen icon: what a phone shows when this app's link is saved.
  // Fetched from the live site and stored on the row, so the list does not make
  // a request to eleven other origins every time it renders.
  async function fetchIcon(explicit?: string) {
    setIconState("fetching");
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/apps/${app.id}/icon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(explicit ? { url: explicit } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not fetch the icon");
      setApp(data.app as App);
      setIconUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch the icon");
    } finally {
      setIconState("idle");
    }
  }

  async function clearIcon() {
    setIconState("fetching");
    try {
      const res = await fetch(`/api/agent-ops/apps/${app.id}/icon`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not clear it");
      setApp(data.app as App);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear it");
    } finally {
      setIconState("idle");
    }
  }

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

      <div className={styles.iconRow}>
        <AppIcon app={app} size={52} />
        <div className={styles.iconRowBody}>
          <span className={styles.fieldLabel}>Icon</span>
          <span className={styles.fieldHint}>
            {app.icon_url
              ? `From the ${app.icon_source ?? "site"}. Fetch again after it changes.`
              : "The image a phone uses when this link is saved to the home screen. Needs a live URL, or paste one."}
          </span>
          <div className={styles.iconActions}>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={iconState === "fetching"}
              onClick={() => fetchIcon()}
            >
              {iconState === "fetching" ? "Fetching…" : app.icon_url ? "Fetch again" : "Fetch from site"}
            </button>
            {app.icon_url && (
              <button
                type="button"
                className={styles.ghostButton}
                disabled={iconState === "fetching"}
                onClick={clearIcon}
              >
                Clear
              </button>
            )}
          </div>
          <input
            value={iconUrl}
            placeholder="…or paste an image URL"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setIconUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && iconUrl.trim()) fetchIcon(iconUrl.trim());
            }}
          />
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
