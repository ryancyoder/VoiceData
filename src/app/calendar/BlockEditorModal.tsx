"use client";

import { useState } from "react";
import { STAGES, type Stage } from "@/lib/salesBoard";
import { STAGE_COLORS, type PlanningBlock, type BlockKind } from "@/lib/planning/blocks";
import styles from "./calendar.module.css";

const WEEKDAYS = [
  { n: 0, label: "Sun" },
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
];

interface FormState {
  stage: Stage;
  title: string;
  kind: BlockKind;
  blockDate: string;
  weekdays: number[];
  startsOn: string;
  endsOn: string;
  startTime: string;
  endTime: string;
}

function toForm(block: PlanningBlock | null, defaultDate: string): FormState {
  if (!block) {
    return {
      stage: "Propose",
      title: "",
      kind: "one_off",
      blockDate: defaultDate,
      weekdays: [1, 2],
      startsOn: "",
      endsOn: "",
      startTime: "09:00",
      endTime: "12:00",
    };
  }
  return {
    stage: block.stage,
    title: block.title ?? "",
    kind: block.kind,
    blockDate: block.blockDate ?? defaultDate,
    weekdays: block.weekdays ?? [],
    startsOn: block.startsOn ?? "",
    endsOn: block.endsOn ?? "",
    startTime: block.startTime,
    endTime: block.endTime,
  };
}

// Create / edit / delete a planning block. onSaved fires after any successful
// write; the parent refreshes server data and closes the modal.
export default function BlockEditorModal({
  block,
  defaultDate,
  onClose,
  onSaved,
}: {
  block: PlanningBlock | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(block, defaultDate));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = !!block;
  const busy = saving || deleting;
  const stageColor = STAGE_COLORS[form.stage] ?? "var(--c-propose)";

  function toggleWeekday(n: number) {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(n) ? f.weekdays.filter((x) => x !== n) : [...f.weekdays, n].sort((a, b) => a - b),
    }));
  }

  async function handleSave() {
    setError(null);
    if (form.kind === "one_off" && !form.blockDate) return setError("Pick a date.");
    if (form.kind === "recurring" && form.weekdays.length === 0) return setError("Pick at least one weekday.");
    if (form.endTime <= form.startTime) return setError("End time must be after the start time.");

    setSaving(true);
    const body = {
      stage: form.stage,
      title: form.title.trim() || null,
      kind: form.kind,
      blockDate: form.kind === "one_off" ? form.blockDate : null,
      weekdays: form.kind === "recurring" ? form.weekdays : null,
      startsOn: form.kind === "recurring" && form.startsOn ? form.startsOn : null,
      endsOn: form.kind === "recurring" && form.endsOn ? form.endsOn : null,
      startTime: form.startTime,
      endTime: form.endTime,
    };
    try {
      const res = editing
        ? await fetch(`/api/planning/blocks/${block!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/planning/blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Save failed");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!block) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/planning/blocks/${block.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Delete failed");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <div
      className={styles["modal-overlay"]}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={styles["modal-panel"]}>
        <div className={styles["modal-head"]}>
          <h2 className={styles["modal-title"]}>{editing ? "Edit block" : "New block"}</h2>
          <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>
        <div className={styles["event-edit-form"]}>
          <label className={styles["event-edit-label"]}>
            Work stage
            <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as Stage })}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className={styles["event-edit-label"]}>
            Label (optional)
            <input
              type="text"
              placeholder={`e.g. ${form.stage} time`}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>

          <label className={styles["event-edit-label"]}>
            Repeat
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as BlockKind })}>
              <option value="one_off">One-off (single day)</option>
              <option value="recurring">Recurring (weekly)</option>
            </select>
          </label>

          {form.kind === "one_off" ? (
            <label className={styles["event-edit-label"]}>
              Date
              <input type="date" value={form.blockDate} onChange={(e) => setForm({ ...form, blockDate: e.target.value })} />
            </label>
          ) : (
            <>
              <div className={styles["event-edit-label"]}>
                Days
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {WEEKDAYS.map((w) => {
                    const on = form.weekdays.includes(w.n);
                    return (
                      <button
                        key={w.n}
                        type="button"
                        onClick={() => toggleWeekday(w.n)}
                        aria-pressed={on}
                        style={{
                          padding: "4px 9px",
                          borderRadius: 6,
                          border: "1px solid var(--border, #d1d5db)",
                          background: on ? stageColor : "transparent",
                          color: on ? "#fff" : "inherit",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className={styles["event-edit-label"]}>
                Starts on (optional)
                <input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
              </label>
              <label className={styles["event-edit-label"]}>
                Ends on (optional)
                <input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
              </label>
            </>
          )}

          <label className={styles["event-edit-label"]}>
            Start time
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </label>
          <label className={styles["event-edit-label"]}>
            End time
            <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          </label>

          {error && <div className={styles["upload-error"]}>{error}</div>}

          <div className={styles["upload-actions"]}>
            {editing && (
              <button
                type="button"
                className={styles["card-edit-cancel"]}
                onClick={handleDelete}
                disabled={busy}
                style={{ marginRight: "auto", color: "var(--danger, #c0392b)" }}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
            <button type="button" className={styles["card-edit-cancel"]} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={styles["card-edit-save"]} onClick={handleSave} disabled={busy}>
              {saving ? "Saving…" : editing ? "Save block" : "Create block"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
