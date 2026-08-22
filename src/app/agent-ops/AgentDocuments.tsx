"use client";

import { useState } from "react";
import WikiMarkdown from "@/app/voicemap/wiki/WikiMarkdown";
import type { AgentDocumentListing } from "@/lib/agentOps";
import styles from "./agentOps.module.css";

type Mode = { kind: "view" } | { kind: "edit" } | { kind: "new" };

function day(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// The reference material this agent reads — SOPs, formats, playbooks. Long
// things that would bloat a brief but that the agent still needs in front of
// it. A document can belong to several agents at once.
export default function AgentDocuments({
  identity,
  initialDocuments,
}: {
  identity: string;
  initialDocuments: AgentDocumentListing[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [openId, setOpenId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [draft, setDraft] = useState({ title: "", summary: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAttach, setShowAttach] = useState(false);

  const mine = documents.filter((d) => d.linked);
  const others = documents.filter((d) => !d.linked);
  const open = documents.find((d) => d.id === openId) ?? null;

  function startNew() {
    setDraft({ title: "", summary: "", body: "" });
    setOpenId(null);
    setMode({ kind: "new" });
    setError("");
  }

  function startEdit(doc: AgentDocumentListing) {
    setDraft({ title: doc.title, summary: doc.summary, body: doc.body });
    setMode({ kind: "edit" });
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const creating = mode.kind === "new";
      const res = await fetch(
        creating ? "/api/agent-ops/documents" : `/api/agent-ops/documents/${openId}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(creating ? { ...draft, identities: [identity] } : draft),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save it");
      const saved = data.document as AgentDocumentListing;
      setDocuments((prev) =>
        creating
          ? [...prev, { ...saved, linked: true }].sort((a, b) => a.title.localeCompare(b.title))
          : prev.map((d) => (d.id === saved.id ? { ...saved, linked: d.linked } : d))
      );
      setOpenId(saved.id);
      setMode({ kind: "view" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save it");
    } finally {
      setBusy(false);
    }
  }

  async function setLinked(doc: AgentDocumentListing, linked: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/documents/${doc.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity, linked }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error || "Could not change it");
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, linked } : d)));
      if (!linked && openId === doc.id) setOpenId(null);
      if (linked) {
        setOpenId(doc.id);
        setShowAttach(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Documents</h2>
          <p>
            Reference material this agent reads — formats, playbooks, the rules too long to sit inside a
            brief. A document can belong to more than one agent.
          </p>
        </div>
        <button type="button" className={styles.ghostButton} onClick={startNew}>
          New
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {mine.length === 0 && mode.kind !== "new" && (
        <p className={styles.empty}>
          Nothing attached to {identity} yet. Write one, or attach a document another agent already uses.
        </p>
      )}

      <ul className={styles.docList}>
        {mine.map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              className={doc.id === openId ? styles.docRowOpen : styles.docRow}
              onClick={() => {
                setOpenId(doc.id === openId ? null : doc.id);
                setMode({ kind: "view" });
              }}
            >
              <span className={styles.docTitle}>{doc.title}</span>
              {doc.summary && <span className={styles.docSummary}>{doc.summary}</span>}
              <span className={styles.docMeta}>updated {day(doc.updated_at)}</span>
            </button>
          </li>
        ))}
      </ul>

      {others.length > 0 && mode.kind !== "new" && (
        <div className={styles.heldBlock}>
          <button type="button" className={styles.ghostButton} onClick={() => setShowAttach(!showAttach)}>
            {showAttach ? "Hide" : `Attach one of ${others.length} other document${others.length === 1 ? "" : "s"}`}
          </button>
          {showAttach && (
            <ul className={styles.docList}>
              {others.map((doc) => (
                <li key={doc.id} className={styles.attachRow}>
                  <div>
                    <span className={styles.docTitle}>{doc.title}</span>
                    {doc.summary && <span className={styles.docSummary}>{doc.summary}</span>}
                  </div>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={busy}
                    onClick={() => setLinked(doc, true)}
                  >
                    Attach
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(mode.kind === "new" || mode.kind === "edit") && (
        <div className={styles.docEditor}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Title</span>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Summary</span>
            <span className={styles.fieldHint}>One line — what the list shows under the title.</span>
            <input value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Markdown</span>
            <textarea
              rows={16}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={save} disabled={busy || !draft.title.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => setMode({ kind: "view" })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && mode.kind === "view" && (
        <div className={styles.docViewer}>
          <div className={styles.docViewerHead}>
            <button type="button" className={styles.ghostButton} onClick={() => startEdit(open)}>
              Edit
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={busy}
              onClick={() => setLinked(open, false)}
            >
              Detach
            </button>
          </div>
          {open.body.trim() ? (
            <WikiMarkdown markdown={open.body} />
          ) : (
            <p className={styles.empty}>This document is empty. Tap Edit to write it.</p>
          )}
        </div>
      )}
    </div>
  );
}
