"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FIELD_LABELS,
  changedFields,
  condenseDiff,
  diffLines,
  draftFrom,
  fieldText,
  formatWhen,
  type AgentPromptVersion,
  type EditableField,
} from "@/lib/agentOps";
import styles from "../agent-ops.module.css";

// Brief history. Every state the brief has been in is here, current included —
// the table is append-only, so a rollback moves forward to a new version whose
// content matches the old one rather than erasing the bad edit.
export default function BriefVersions({
  identity,
  currentVersion,
  versions,
}: {
  identity: string;
  currentVersion: number;
  versions: AgentPromptVersion[];
}) {
  const router = useRouter();
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [error, setError] = useState("");

  const current = versions.find((v) => v.version === currentVersion) ?? versions[0];

  async function restore(version: number) {
    if (!window.confirm(`Roll ${identity}'s brief back to v${version}? This saves as a new version.`)) return;
    setRestoring(version);
    setError("");
    try {
      const res = await fetch("/api/agent-ops/prompt/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity, version }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Restore failed");
        return;
      }
      setOpenVersion(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(null);
    }
  }

  if (!versions.length) {
    return (
      <div className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>History</h2>
        </div>
        <p className={styles.diffNone}>No snapshots yet — the first save writes one.</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.sectionHead}>
        <h2>History</h2>
        <p>{versions.length} versions</p>
      </div>
      {error && <p className={styles.saveError}>{error}</p>}

      <div className={styles.versionList}>
        {versions.map((version, index) => {
          const previous = versions[index + 1];
          const changed = previous ? changedFields(draftFrom(previous), draftFrom(version)) : [];
          const isCurrent = version.version === currentVersion;
          const open = openVersion === version.version;

          return (
            <div key={version.id} className={styles.version}>
              <div className={styles.versionHead}>
                <strong>
                  v{version.version}
                  {isCurrent ? " · current" : ""}
                </strong>
                <span className={styles.versionMeta}>
                  {formatWhen(version.created_at)}
                  {version.updated_by ? ` · ${version.updated_by}` : ""}
                </span>
              </div>

              {version.change_note && <p className={styles.versionNote}>{version.change_note}</p>}

              <p className={styles.versionChanged}>
                {previous
                  ? changed.length
                    ? `Changed: ${changed.map((f) => FIELD_LABELS[f].label.split(" —")[0]).join(", ")}`
                    : "No brief content changed"
                  : "First version"}
              </p>

              <div className={styles.versionActions}>
                <button type="button" onClick={() => setOpenVersion(open ? null : version.version)}>
                  {open ? "Hide diff" : isCurrent ? "View" : "Diff vs current"}
                </button>
                {!isCurrent && (
                  <button type="button" onClick={() => restore(version.version)} disabled={restoring !== null}>
                    {restoring === version.version ? "Restoring…" : "Restore"}
                  </button>
                )}
              </div>

              {open && current && <VersionDiff from={version} to={current} showFull={version.version === currentVersion} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What this version would change if restored: its content on the left, the
 *  live brief on the right. For the current version there is nothing to
 *  compare, so its own text is shown instead. */
function VersionDiff({
  from,
  to,
  showFull,
}: {
  from: AgentPromptVersion;
  to: AgentPromptVersion;
  showFull: boolean;
}) {
  const fromDraft = draftFrom(from);
  const toDraft = draftFrom(to);
  const fields = showFull
    ? (Object.keys(FIELD_LABELS) as EditableField[])
    : changedFields(fromDraft, toDraft);

  if (!fields.length) {
    return <p className={styles.diffNone}>Identical to the live brief.</p>;
  }

  return (
    <div className={styles.diff}>
      {fields.map((field) => {
        const before = fieldText(fromDraft, field);
        const after = fieldText(toDraft, field);
        const rows = showFull
          ? before.split("\n").map((text) => ({ op: "same" as const, text }))
          : condenseDiff(diffLines(before, after));

        return (
          <div key={field} className={styles.diffField}>
            <strong>{FIELD_LABELS[field].label}</strong>
            {rows.map((row, i) =>
              row.op === "gap" ? (
                <div key={i} className={`${styles.diffLine} ${styles.diffSame}`}>
                  ⋯ {row.count} unchanged {row.count === 1 ? "line" : "lines"}
                </div>
              ) : (
                <div
                  key={i}
                  className={`${styles.diffLine} ${
                    row.op === "add" ? styles.diffAdd : row.op === "remove" ? styles.diffRemove : styles.diffSame
                  }`}
                >
                  {row.op === "add" ? "+ " : row.op === "remove" ? "− " : "  "}
                  {row.text}
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
