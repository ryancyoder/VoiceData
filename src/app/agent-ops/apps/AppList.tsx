"use client";

import { useState } from "react";
import Link from "next/link";
import type { App } from "@/lib/agentOps";
import AppIcon from "./AppIcon";
import styles from "../agentOps.module.css";

// Every app app-developer builds. Each row opens its own page, where its
// documentation lives.
export default function AppList({
  initialApps,
  docCounts,
}: {
  initialApps: App[];
  docCounts: Record<number, number>;
}) {
  const [apps, setApps] = useState(initialApps);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", repo: "", live_url: "", summary: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const shown = apps.filter((a) => showArchived || a.status !== "archived");
  const archivedCount = apps.filter((a) => a.status === "archived").length;

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agent-ops/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add it");
      setApps((prev) => [...prev, data.app as App].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft({ name: "", repo: "", live_url: "", summary: "" });
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Apps</h2>
          <p>
            Every build and coding project. Open one for its documentation — how it is put together, how
            it deploys, and what to know before changing it.
          </p>
        </div>
        <button type="button" className={styles.ghostButton} onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "New app"}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {adding && (
        <div className={styles.docEditor}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Repo</span>
            <span className={styles.fieldHint}>owner/name — a pasted GitHub URL works too.</span>
            <input
              value={draft.repo}
              placeholder="ryancyoder/something"
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
            <span className={styles.fieldLabel}>Summary</span>
            <textarea
              rows={3}
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={create} disabled={busy || !draft.name.trim()}>
              {busy ? "Adding…" : "Add app"}
            </button>
          </div>
        </div>
      )}

      <ul className={styles.docList}>
        {shown.map((app) => (
          <li key={app.id}>
            <Link href={`/agent-ops/apps/${app.slug}`} className={styles.appRow}>
              <AppIcon app={app} />
              <span className={styles.appRowText}>
                <span className={styles.docTitle}>
                  {app.name}
                  {app.status !== "active" && <span className={styles.tag}>{app.status}</span>}
                </span>
                {app.summary && <span className={styles.docSummary}>{app.summary}</span>}
                <span className={styles.docMeta}>
                  {app.repo ?? "no repo"} · {docCounts[app.id] ?? 0} doc
                  {(docCounts[app.id] ?? 0) === 1 ? "" : "s"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length === 0 && <p className={styles.empty}>No apps yet.</p>}

      {archivedCount > 0 && (
        <div className={styles.heldBlock}>
          <button type="button" className={styles.ghostButton} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide archived" : `${archivedCount} archived`}
          </button>
        </div>
      )}
    </div>
  );
}
