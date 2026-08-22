"use client";

import { useState } from "react";
import WikiMarkdown from "@/app/voicemap/wiki/WikiMarkdown";
import type { AgentDocumentListing, AgentDocumentVersion } from "@/lib/agentOps";
import styles from "./agentOps.module.css";

// Two places show this: an agent's page, where it is that agent's shelf, and
// the console, where it is the shared shelf — the documents that belong to
// every agent or to none in particular.
export type DocScope = { kind: "agent"; identity: string } | { kind: "shared" };

type Mode = "view" | "edit" | "new";

interface Draft {
  title: string;
  summary: string;
  body: string;
  is_global: boolean;
  change_note: string;
}

const emptyDraft = (is_global: boolean): Draft => ({
  title: "",
  summary: "",
  body: "",
  is_global,
  change_note: "",
});

function day(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function stamp(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function AgentDocuments({
  scope,
  initialDocuments,
}: {
  scope: DocScope;
  initialDocuments: AgentDocumentListing[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [openId, setOpenId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(scope.kind === "shared"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [versions, setVersions] = useState<AgentDocumentVersion[] | null>(null);
  const [openVersion, setOpenVersion] = useState<number | null>(null);

  const forAgent = scope.kind === "agent";
  const global = documents.filter((d) => d.is_global);
  // On an agent page: what is attached to it. On the shared shelf: everything
  // that is not global and not filed under any agent, so nothing goes missing.
  const own = forAgent
    ? documents.filter((d) => d.linked && !d.is_global)
    : documents.filter((d) => !d.is_global && !d.linked);
  const attachable = documents.filter((d) => !d.linked && !d.is_global);
  const open = documents.find((d) => d.id === openId) ?? null;

  function show(doc: AgentDocumentListing | null) {
    setOpenId(doc?.id ?? null);
    setMode("view");
    setVersions(null);
    setOpenVersion(null);
    setError("");
  }

  async function loadVersions(id: number) {
    try {
      const res = await fetch(`/api/agent-ops/documents/${id}/versions`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the history");
      setVersions(data.versions as AgentDocumentVersion[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the history");
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const creating = mode === "new";
      const payload = creating
        ? { ...draft, identities: forAgent && !draft.is_global ? [scope.identity] : [] }
        : draft;
      const res = await fetch(
        creating ? "/api/agent-ops/documents" : `/api/agent-ops/documents/${openId}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save it");
      const saved = data.document as AgentDocumentListing;
      const linked = saved.is_global ? false : creating ? forAgent : (open?.linked ?? false);
      setDocuments((prev) =>
        creating
          ? [...prev, { ...saved, linked }].sort((a, b) => a.title.localeCompare(b.title))
          : prev.map((d) => (d.id === saved.id ? { ...saved, linked } : d))
      );
      setOpenId(saved.id);
      setMode("view");
      setVersions(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save it");
    } finally {
      setBusy(false);
    }
  }

  async function setLinked(doc: AgentDocumentListing, linked: boolean) {
    if (!forAgent) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/documents/${doc.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: scope.identity, linked }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error || "Could not change it");
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, linked } : d)));
      if (!linked && openId === doc.id) setOpenId(null);
      if (linked) {
        show(doc);
        setShowAttach(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change it");
    } finally {
      setBusy(false);
    }
  }

  async function restore(version: number) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/documents/${openId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not roll it back");
      const saved = data.document as AgentDocumentListing;
      setDocuments((prev) =>
        prev.map((d) => (d.id === saved.id ? { ...saved, linked: saved.is_global ? false : d.linked } : d))
      );
      setOpenVersion(null);
      await loadVersions(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not roll it back");
    } finally {
      setBusy(false);
    }
  }

  const row = (doc: AgentDocumentListing) => (
    <li key={doc.id}>
      <button
        type="button"
        className={doc.id === openId ? styles.docRowOpen : styles.docRow}
        onClick={() => show(doc.id === openId ? null : doc)}
      >
        <span className={styles.docTitle}>
          {doc.title}
          {doc.is_global && <span className={styles.tag}>all agents</span>}
        </span>
        {doc.summary && <span className={styles.docSummary}>{doc.summary}</span>}
        <span className={styles.docMeta}>
          v{doc.version} · updated {day(doc.updated_at)}
        </span>
      </button>
    </li>
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>{forAgent ? "Documents" : "Shared documents"}</h2>
          <p>
            {forAgent
              ? "Reference material this agent reads — formats, playbooks, the rules too long to sit inside a brief."
              : "Documents that belong to every agent, or to none in particular. The ones marked “all agents” show on every agent’s page."}
          </p>
        </div>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => {
            setDraft(emptyDraft(!forAgent));
            setOpenId(null);
            setMode("new");
            setError("");
          }}
        >
          New
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {own.length === 0 && global.length === 0 && mode !== "new" && (
        <p className={styles.empty}>
          {forAgent
            ? "Nothing here yet. Write one, or attach a document another agent already uses."
            : "Nothing shared yet. A document written here applies to every agent."}
        </p>
      )}

      {own.length > 0 && (
        <>
          {forAgent && global.length > 0 && <p className={styles.groupLabel}>Just this agent</p>}
          {!forAgent && <p className={styles.groupLabel}>Filed under no agent</p>}
          <ul className={styles.docList}>{own.map(row)}</ul>
        </>
      )}

      {global.length > 0 && (
        <>
          <p className={styles.groupLabel}>{forAgent ? "Every agent" : "Applies to every agent"}</p>
          <ul className={styles.docList}>{global.map(row)}</ul>
        </>
      )}

      {forAgent && attachable.length > 0 && mode !== "new" && (
        <div className={styles.heldBlock}>
          <button type="button" className={styles.ghostButton} onClick={() => setShowAttach(!showAttach)}>
            {showAttach ? "Hide" : `Attach one of ${attachable.length} other document${attachable.length === 1 ? "" : "s"}`}
          </button>
          {showAttach && (
            <ul className={styles.docList}>
              {attachable.map((doc) => (
                <li key={doc.id} className={styles.attachRow}>
                  <div>
                    <span className={styles.docTitle}>{doc.title}</span>
                    {doc.summary && <span className={styles.docSummary}>{doc.summary}</span>}
                  </div>
                  <button type="button" className={styles.ghostButton} disabled={busy} onClick={() => setLinked(doc, true)}>
                    Attach
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(mode === "new" || mode === "edit") && (
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
            <textarea rows={16} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={draft.is_global}
              onChange={(e) => setDraft({ ...draft, is_global: e.target.checked })}
            />
            <span>
              Applies to every agent
              <span className={styles.fieldHint}>
                It shows on every agent&apos;s page, and stops being attached to any one of them.
              </span>
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Why this change</span>
            <input
              value={draft.change_note}
              placeholder="e.g. added the rule about unroutable threads"
              onChange={(e) => setDraft({ ...draft, change_note: e.target.value })}
            />
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={save} disabled={busy || !draft.title.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && mode === "view" && (
        <div className={styles.docViewer}>
          <div className={styles.docViewerHead}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => {
                setDraft({
                  title: open.title,
                  summary: open.summary,
                  body: open.body,
                  is_global: open.is_global,
                  change_note: "",
                });
                setMode("edit");
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => (versions ? setVersions(null) : loadVersions(open.id))}
            >
              {versions ? "Hide history" : `History (v${open.version})`}
            </button>
            {forAgent && !open.is_global && (
              <button type="button" className={styles.ghostButton} disabled={busy} onClick={() => setLinked(open, false)}>
                Detach
              </button>
            )}
          </div>

          {versions && (
            <ul className={styles.versions}>
              {versions.map((v) => {
                const current = v.version === open.version;
                const isOpen = openVersion === v.version;
                const changed =
                  v.title !== open.title ||
                  v.summary !== open.summary ||
                  v.body !== open.body ||
                  v.is_global !== open.is_global;
                return (
                  <li key={v.version} className={styles.version}>
                    <button
                      type="button"
                      className={styles.versionHead}
                      onClick={() => setOpenVersion(isOpen ? null : v.version)}
                    >
                      <span className={styles.versionNo}>v{v.version}</span>
                      <span className={styles.versionMeta}>
                        {stamp(v.created_at)}
                        {v.updated_by ? ` · ${v.updated_by}` : ""}
                        {current ? " · current" : ""}
                      </span>
                      <span className={styles.versionNote}>{v.change_note ?? ""}</span>
                    </button>
                    {isOpen && (
                      <div className={styles.versionBody}>
                        {current ? (
                          <p className={styles.empty}>This is the document as it stands.</p>
                        ) : !changed ? (
                          <p className={styles.empty}>Identical to the current document.</p>
                        ) : (
                          <div className={styles.diff}>
                            <span className={styles.fieldLabel}>{v.title}</span>
                            <div className={styles.diffWas}>
                              <span>was (v{v.version})</span>
                              <pre>{v.body || "—"}</pre>
                            </div>
                          </div>
                        )}
                        {!current && (
                          <button type="button" className={styles.ghostButton} disabled={busy} onClick={() => restore(v.version)}>
                            Roll back to v{v.version}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!versions &&
            (open.body.trim() ? (
              <WikiMarkdown markdown={open.body} />
            ) : (
              <p className={styles.empty}>This document is empty. Tap Edit to write it.</p>
            ))}
        </div>
      )}
    </div>
  );
}
