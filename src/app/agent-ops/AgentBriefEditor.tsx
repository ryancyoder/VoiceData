"use client";

import { useMemo, useState } from "react";
import {
  BRIEF_FIELDS,
  FIELD_HINTS,
  FIELD_LABELS,
  arrayToLines,
  linesToArray,
  type AgentPrompt,
  type AgentPromptVersion,
  type BriefFields,
} from "@/lib/agentOps";
import styles from "./agentOps.module.css";

// Every field is edited as text, including the two arrays (one resource per
// line) — a thumb on a phone is the only input this screen can count on.
type Draft = Record<(typeof BRIEF_FIELDS)[number], string>;

const ARRAY_FIELDS = new Set<keyof BriefFields>(["owned_resources", "readonly_resources"]);
const ROWS: Record<(typeof BRIEF_FIELDS)[number], number> = {
  mandate: 3,
  owned_resources: 6,
  readonly_resources: 6,
  run_loop: 12,
  escalation_rules: 10,
  handoff_rules: 12,
};

function toDraft(source: BriefFields): Draft {
  return {
    mandate: source.mandate ?? "",
    owned_resources: arrayToLines(source.owned_resources),
    readonly_resources: arrayToLines(source.readonly_resources),
    run_loop: source.run_loop ?? "",
    escalation_rules: source.escalation_rules ?? "",
    handoff_rules: source.handoff_rules ?? "",
  };
}

function fmt(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function AgentBriefEditor({
  identity,
  initialPrompt,
  initialVersions,
}: {
  identity: string;
  initialPrompt: AgentPrompt;
  initialVersions: AgentPromptVersion[];
}) {
  const [prompt, setPrompt] = useState<AgentPrompt>(initialPrompt);
  const [versions, setVersions] = useState<AgentPromptVersion[]>(initialVersions);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialPrompt));
  const [changeNote, setChangeNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const saved = useMemo(() => toDraft(prompt), [prompt]);
  const dirty = BRIEF_FIELDS.some((field) => draft[field].trim() !== saved[field].trim());

  // The database bumps the version and writes the snapshot; the response tells
  // us what it landed on, so the history below stays right without a reload.
  function applySaved(next: AgentPrompt) {
    setPrompt(next);
    setDraft(toDraft(next));
    setVersions((prev) =>
      prev.some((v) => v.version === next.version)
        ? prev
        : [
            {
              id: -next.version,
              prompt_id: next.id,
              identity: next.identity,
              version: next.version,
              mandate: next.mandate,
              owned_resources: next.owned_resources,
              readonly_resources: next.readonly_resources,
              run_loop: next.run_loop,
              escalation_rules: next.escalation_rules,
              handoff_rules: next.handoff_rules,
              updated_by: next.updated_by,
              change_note: next.change_note,
              created_at: next.updated_at,
            },
            ...prev,
          ]
    );
  }

  async function save() {
    setState("saving");
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/${encodeURIComponent(identity)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mandate: draft.mandate,
          owned_resources: linesToArray(draft.owned_resources),
          readonly_resources: linesToArray(draft.readonly_resources),
          run_loop: draft.run_loop,
          escalation_rules: draft.escalation_rules,
          handoff_rules: draft.handoff_rules,
          change_note: changeNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      applySaved(data.prompt as AgentPrompt);
      setChangeNote("");
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setState("idle");
    }
  }

  async function restore(version: number) {
    setState("saving");
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/${encodeURIComponent(identity)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rollback failed");
      applySaved(data.prompt as AgentPrompt);
      setOpenVersion(null);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed");
      setState("idle");
    }
  }

  // Fetched rather than rendered here, so the copy carries the agent's
  // documents and the rules every agent follows — not just this row — and so
  // it reflects what those say now.
  async function copyBrief() {
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/${encodeURIComponent(identity)}/brief`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not build the brief");
      await navigator.clipboard.writeText(data.markdown as string);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "" && !err.message.includes("clipboard")
          ? err.message
          : "Could not copy — select the fields and copy manually."
      );
    }
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>Brief v{prompt.version}</h2>
            <p>
              Last edited {fmt(prompt.updated_at)}
              {prompt.updated_by ? ` by ${prompt.updated_by}` : ""}
              {prompt.change_note ? ` — ${prompt.change_note}` : ""}. Agents pick this up on their next
              session.
            </p>
          </div>
          <button type="button" className={styles.ghostButton} onClick={copyBrief}>
            {copied ? "Copied ✓" : "Copy brief"}
          </button>
        </div>

        {BRIEF_FIELDS.map((field) => (
          <label key={field} className={styles.field}>
            <span className={styles.fieldLabel}>{FIELD_LABELS[field]}</span>
            <span className={styles.fieldHint}>{FIELD_HINTS[field]}</span>
            <textarea
              value={draft[field]}
              rows={ROWS[field]}
              spellCheck={!ARRAY_FIELDS.has(field)}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            />
          </label>
        ))}

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Why this change</span>
          <span className={styles.fieldHint}>
            Optional, but it is what makes the history readable six weeks from now.
          </span>
          <input
            value={changeNote}
            placeholder="e.g. scheduler kept booking over drive time"
            onChange={(e) => setChangeNote(e.target.value)}
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
          {dirty && (
            <button type="button" className={styles.ghostButton} onClick={() => setDraft(saved)}>
              Discard
            </button>
          )}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>History</h2>
            <p>
              Every save snapshots the brief, so a bad edit can be read back and rolled back. A rollback is
              itself a new version — nothing is erased.
            </p>
          </div>
        </div>

        {versions.length === 0 && <p className={styles.empty}>No snapshots yet.</p>}

        <ul className={styles.versions}>
          {versions.map((version) => {
            const current = version.version === prompt.version;
            const open = openVersion === version.version;
            const changed = BRIEF_FIELDS.filter(
              (field) => toDraft(version)[field].trim() !== saved[field].trim()
            );
            return (
              <li key={version.version} className={styles.version}>
                <button
                  type="button"
                  className={styles.versionHead}
                  onClick={() => setOpenVersion(open ? null : version.version)}
                >
                  <span className={styles.versionNo}>v{version.version}</span>
                  <span className={styles.versionMeta}>
                    {fmt(version.created_at)}
                    {version.updated_by ? ` · ${version.updated_by}` : ""}
                    {current ? " · current" : ""}
                  </span>
                  <span className={styles.versionNote}>{version.change_note ?? ""}</span>
                </button>

                {open && (
                  <div className={styles.versionBody}>
                    {current ? (
                      <p className={styles.empty}>This is the brief the agents are running on now.</p>
                    ) : changed.length === 0 ? (
                      <p className={styles.empty}>Identical to the current brief.</p>
                    ) : (
                      changed.map((field) => (
                        <div key={field} className={styles.diff}>
                          <span className={styles.fieldLabel}>{FIELD_LABELS[field]}</span>
                          <div className={styles.diffWas}>
                            <span>was (v{version.version})</span>
                            <pre>{toDraft(version)[field] || "—"}</pre>
                          </div>
                          <div className={styles.diffNow}>
                            <span>now (v{prompt.version})</span>
                            <pre>{saved[field] || "—"}</pre>
                          </div>
                        </div>
                      ))
                    )}
                    {!current && (
                      <button
                        type="button"
                        className={styles.ghostButton}
                        disabled={state === "saving"}
                        onClick={() => restore(version.version)}
                      >
                        Roll back to v{version.version}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
