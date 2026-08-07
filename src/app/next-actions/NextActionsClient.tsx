"use client";

import { useEffect, useRef, useState } from "react";
import { STAGES, type Stage } from "@/lib/salesBoard";
import { fetchWithTimeout } from "@/lib/withTimeout";
import styles from "./next-actions.module.css";

const SAVE_TIMEOUT_MS = 15000;

const STAGE_COLORS: Record<Stage, string> = {
  Lead: "var(--c-lead)",
  Propose: "var(--c-propose)",
  Sent: "var(--c-send)",
  Sold: "var(--c-sold)",
  Scheduled: "var(--c-schedule)",
  "Project Management": "var(--c-pm)",
  "Job Costing": "var(--c-jobcosting)",
  Invoiced: "var(--c-invoiced)",
  "Paid in Full": "var(--c-paid)",
};

export interface NextActionRow {
  id: number;
  dealName: string;
  stage: Stage;
  lostAt: string | null;
  contactLastName: string | null;
  nextActionTaskId: number | null;
  nextActionTitle: string;
}

export default function NextActionsClient({ initialRows }: { initialRows: NextActionRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [drafts, setDraftsState] = useState<Record<number, string>>({});
  // Mirrors `drafts`, but mutated synchronously — needed because focusRow()'s
  // .focus() call blurs the previous input (firing its onBlur -> commit)
  // before React has flushed the state update that cleared its draft, which
  // otherwise let commit() run twice for the same edit (duplicate saves).
  const draftsRef = useRef<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<Set<Stage>>(new Set(STAGES));
  const [showLost, setShowLost] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  const visibleRows = rows.filter((r) => {
    if (!showLost && r.lostAt) return false;
    if (!stageFilter.has(r.stage)) return false;
    if (missingOnly && r.nextActionTitle.trim()) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = `${r.contactLastName ?? ""} ${r.dealName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  function toggleStage(stage: Stage) {
    setStageFilter((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  function focusRow(index: number) {
    const row = visibleRows[index];
    if (!row) return;
    const el = inputRefs.current[row.id];
    if (el) {
      el.focus();
      el.select();
    }
  }

  function setDraft(rowId: number, value: string) {
    draftsRef.current = { ...draftsRef.current, [rowId]: value };
    setDraftsState(draftsRef.current);
  }

  function clearDraft(rowId: number) {
    const next = { ...draftsRef.current };
    delete next[rowId];
    draftsRef.current = next;
    setDraftsState(next);
  }

  async function commit(rowId: number) {
    const draft = draftsRef.current[rowId];
    if (draft === undefined) return;
    const row = rows.find((r) => r.id === rowId);
    clearDraft(rowId);
    if (!row) return;

    const trimmed = draft.trim();
    if (trimmed === row.nextActionTitle.trim()) return;

    setSaving((s) => ({ ...s, [rowId]: true }));
    try {
      if (!trimmed) {
        // Cleared — unflag the existing task rather than deleting it, so
        // any context/date/hours already set on it (via the Tasks page or
        // a deal's modal) isn't lost, just no longer surfaced here.
        if (row.nextActionTaskId != null) {
          const res = await fetchWithTimeout(
            `/api/tasks/${row.nextActionTaskId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ is_next_action: false }),
            },
            SAVE_TIMEOUT_MS
          );
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to clear next action");
          }
        }
        setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, nextActionTitle: "", nextActionTaskId: null } : r)));
      } else if (row.nextActionTaskId != null) {
        const res = await fetchWithTimeout(
          `/api/tasks/${row.nextActionTaskId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: trimmed }),
          },
          SAVE_TIMEOUT_MS
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save next action");
        setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, nextActionTitle: trimmed } : r)));
      } else {
        const res = await fetchWithTimeout(
          "/api/tasks",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: trimmed, deal_id: rowId, is_next_action: true }),
          },
          SAVE_TIMEOUT_MS
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save next action");
        setRows((rs) =>
          rs.map((r) => (r.id === rowId ? { ...r, nextActionTitle: trimmed, nextActionTaskId: data.task.id } : r))
        );
      }
      window.dispatchEvent(new Event("tasks:changed"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save next action");
    } finally {
      setSaving((s) => {
        const next = { ...s };
        delete next[rowId];
        return next;
      });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowId: number, index: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      commit(rowId);
      focusRow(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      commit(rowId);
      focusRow(index - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearDraft(rowId);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Next Actions</h1>
        <p className={styles.hint}>Click into a row and type — Enter or ↓/↑ saves and moves to the next deal.</p>
      </header>

      <div className={styles["filter-bar"]}>
        <input
          type="text"
          placeholder="Search contact or deal…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles["search-input"]}
        />
        <div className={styles["stage-filters"]}>
          {STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              className={`${styles["stage-chip"]} ${stageFilter.has(stage) ? styles["is-active"] : ""}`}
              style={{ ["--chip-color" as string]: STAGE_COLORS[stage] }}
              onClick={() => toggleStage(stage)}
            >
              {stage}
            </button>
          ))}
        </div>
        <label className={styles["filter-toggle"]}>
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          Missing only
        </label>
        <label className={styles["filter-toggle"]}>
          <input type="checkbox" checked={showLost} onChange={(e) => setShowLost(e.target.checked)} />
          Show lost
        </label>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Deal</th>
            <th>Next Action</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => (
            <tr key={row.id} style={{ ["--row-color" as string]: STAGE_COLORS[row.stage] }}>
              <td className={styles["deal-cell"]}>{row.dealName}</td>
              <td className={styles["action-cell"]}>
                <input
                  ref={(el) => {
                    inputRefs.current[row.id] = el;
                  }}
                  type="text"
                  className={styles["action-input"]}
                  placeholder="No next action — type to add one"
                  value={drafts[row.id] ?? row.nextActionTitle}
                  disabled={!!saving[row.id]}
                  onChange={(e) => setDraft(row.id, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, row.id, index)}
                  onBlur={() => commit(row.id)}
                />
              </td>
            </tr>
          ))}
          {visibleRows.length === 0 && (
            <tr>
              <td colSpan={2} className={styles["empty-row"]}>
                No deals match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className={`${styles.toast} ${toast ? styles["is-visible"] : ""}`} role="status" aria-live="polite">
        <span>{toast}</span>
      </div>
    </div>
  );
}
