"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./tasks.module.css";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { TASK_CONTEXTS, formatDealLabel, formatDuration, type Task, type TaskContext, type TaskDeal } from "@/lib/tasks";

const SUBMIT_TIMEOUT_MS = 15000;

const CONTEXT_COLORS: Record<TaskContext, string> = {
  Office: "var(--ctx-office)",
  Field: "var(--ctx-field)",
  Phone: "var(--ctx-phone)",
  Design: "var(--ctx-design)",
  Errand: "var(--ctx-errand)",
  Waiting: "var(--ctx-waiting)",
};

type DealFilter = "all" | "none" | number;

interface TaskFormState {
  title: string;
  deal_id: number | null;
  context: TaskContext | "";
  start_date: string;
  duration_hours: string;
}

const EMPTY_TASK_FORM: TaskFormState = { title: "", deal_id: null, context: "", start_date: "", duration_hours: "" };

function formatStartDate(isoDate: string) {
  // A plain YYYY-MM-DD parsed with `new Date()` is treated as UTC midnight,
  // which can print as the previous day in a negative-UTC-offset timezone —
  // parsing the parts directly keeps it the literal date that was stored.
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TasksClient({
  initialTasks,
  dealOptions,
}: {
  initialTasks: Task[];
  dealOptions: TaskDeal[];
}) {
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [selectedContexts, setSelectedContexts] = useState<Set<TaskContext>>(() => new Set(TASK_CONTEXTS));
  const [dealFilter, setDealFilter] = useState<DealFilter>("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_TASK_FORM);
  const [wantsNextAction, setWantsNextAction] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  // Reacts to the URL's ?deal= param (the Sales Board deal modal links
  // here) rather than only reading it once on mount, so it also fires for
  // a second visit while this page is already open. Resetting the context
  // filter and revealing completed tasks guarantees the target deal's
  // tasks actually show, the same rationale as the Properties page's
  // ?property= handling.
  const [lastSearchParams, setLastSearchParams] = useState<typeof searchParams | null>(null);
  if (searchParams !== lastSearchParams) {
    setLastSearchParams(searchParams);
    const dealParam = searchParams.get("deal");
    const dealId = dealParam ? Number(dealParam) : NaN;
    if (Number.isFinite(dealId)) {
      setDealFilter(dealId);
      setSelectedContexts(new Set(TASK_CONTEXTS));
      setShowCompleted(true);
    }
  }

  function toggleContext(context: TaskContext) {
    setSelectedContexts((prev) => {
      const next = new Set(prev);
      if (next.has(context)) next.delete(context);
      else next.add(context);
      return next;
    });
  }

  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (!showCompleted && t.completed_at) return false;
      if (selectedContexts.size !== TASK_CONTEXTS.length) {
        if (t.context == null || !selectedContexts.has(t.context)) return false;
      }
      if (dealFilter === "none" && t.deal_id != null) return false;
      if (typeof dealFilter === "number" && t.deal_id !== dealFilter) return false;
      return true;
    });
  }, [tasks, showCompleted, selectedContexts, dealFilter]);

  async function refreshTasks() {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    if (res.ok) setTasks(data.tasks);
  }

  // The floating quick-add button (voice dictation, logged from the root
  // layout so it works on any page) has no way to reach this component's
  // state directly — it broadcasts this event instead, both right after
  // logging a task and again once background analysis fills in its
  // context/dates, so this list picks up either change live if it's the
  // page currently open.
  useEffect(() => {
    function onTasksChanged() {
      refreshTasks();
    }
    window.addEventListener("tasks:changed", onTasksChanged);
    return () => window.removeEventListener("tasks:changed", onTasksChanged);
  }, []);

  // Deliberately left unmemoized, matching the other handlers in this
  // file — the Alt+N effect below re-subscribing whenever this identity
  // changes (i.e. every render) is harmless, and is what keeps it from
  // ever closing over a stale `dealFilter`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function openAddForm() {
    setEditingTask(null);
    setForm({ ...EMPTY_TASK_FORM, deal_id: typeof dealFilter === "number" ? dealFilter : null });
    setWantsNextAction(false);
    setFormError("");
    setFormOpen(true);
  }

  function openEditForm(task: Task) {
    setEditingTask(task);
    setForm({
      title: task.title,
      deal_id: task.deal_id,
      context: task.context ?? "",
      start_date: task.start_date ?? "",
      duration_hours: task.duration_hours != null ? String(task.duration_hours) : "",
    });
    setWantsNextAction(task.is_next_action);
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingTask(null);
    setForm(EMPTY_TASK_FORM);
    setFormError("");
  }

  // Alt/Option+N opens the add-task form — not Cmd+N/Ctrl+N, which is
  // reserved by every major browser (including Safari) for "New Window"
  // and never reaches page JavaScript at all. Checked via e.code rather
  // than e.key for the same reason as the Next Actions page's Alt+K: on
  // macOS, Option+<letter> is a dead-key modifier that can type an
  // accented/special character into e.key, so e.key wouldn't reliably
  // read as "n" there — e.code stays "KeyN" regardless of modifiers.
  // Guarded on the form already being open so a stray Alt+N can't wipe
  // out a title the user's mid-typing.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.code === "KeyN" && !formOpen) {
        e.preventDefault();
        openAddForm();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [formOpen, openAddForm]);

  // The task currently holding this deal's next-action flag, if it isn't
  // the one being edited — surfaced as a heads-up, since checking the box
  // will bump it.
  const conflictingNextAction =
    form.deal_id != null
      ? tasks.find((t) => t.deal_id === form.deal_id && t.is_next_action && t.id !== editingTask?.id) ?? null
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const title = form.title.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      const payload = {
        title,
        deal_id: form.deal_id,
        context: form.context || null,
        start_date: form.start_date || null,
        duration_hours: form.duration_hours.trim() ? Number(form.duration_hours) : null,
        is_next_action: wantsNextAction && form.deal_id != null,
      };
      const res = await fetchWithTimeout(
        editingTask ? `/api/tasks/${editingTask.id}` : "/api/tasks",
        {
          method: editingTask ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        SUBMIT_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save task");
      await refreshTasks();
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editingTask) return;
    if (!window.confirm(`Delete task "${editingTask.title}"? This can't be undone.`)) return;
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch(`/api/tasks/${editingTask.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete task");
      }
      setTasks((ts) => ts.filter((t) => t.id !== editingTask.id));
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to delete task");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleDone(task: Task) {
    const completedAt = task.completed_at ? null : new Date().toISOString();
    const previous = tasks;
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, completed_at: completedAt } : t)));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_at: completedAt }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }
    } catch (err) {
      setTasks(previous);
      showToast(`Couldn't update "${task.title}" — ${err instanceof Error ? err.message : "try again"}`);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <h1>Tasks</h1>
          <p>
            {visibleTasks.length === tasks.length
              ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}`
              : `${visibleTasks.length} of ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className={styles.toolbar}>
          <button type="button" className={styles["nav-btn"]} title="New task (⌥N)" onClick={openAddForm}>
            + Add Task
          </button>
        </div>
      </div>

      <div className={styles["filter-bar"]}>
        {TASK_CONTEXTS.map((context) => {
          const active = selectedContexts.has(context);
          return (
            <button
              key={context}
              type="button"
              className={`${styles["filter-chip"]} ${active ? styles["is-active"] : ""}`}
              style={{ ["--chip-color" as string]: CONTEXT_COLORS[context] }}
              onClick={() => toggleContext(context)}
              aria-pressed={active}
            >
              {context}
            </button>
          );
        })}
        <select
          className={styles["filter-select"]}
          value={dealFilter === "all" || dealFilter === "none" ? dealFilter : String(dealFilter)}
          onChange={(e) => {
            const v = e.target.value;
            setDealFilter(v === "all" || v === "none" ? v : Number(v));
          }}
        >
          <option value="all">All deals</option>
          <option value="none">No deal</option>
          {dealOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {formatDealLabel(d)}
            </option>
          ))}
        </select>
        <label className={styles["filter-toggle"]}>
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed
        </label>
        <span className={styles["filter-actions"]}>
          <button type="button" className={styles["filter-link"]} onClick={() => setSelectedContexts(new Set(TASK_CONTEXTS))}>
            All
          </button>
          <button type="button" className={styles["filter-link"]} onClick={() => setSelectedContexts(new Set())}>
            None
          </button>
        </span>
      </div>

      <div className={styles.content}>
        {tasks.length === 0 ? (
          <div className={styles.empty}>No tasks yet. Add one to get started.</div>
        ) : visibleTasks.length === 0 ? (
          <div className={styles.empty}>No tasks match the current filters.</div>
        ) : (
          <div className={styles["table-wrap"]}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th></th>
                  <th>Title</th>
                  <th>Deal</th>
                  <th>Context</th>
                  <th>Start</th>
                  <th>Duration</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task) => (
                  <tr
                    key={task.id}
                    className={task.completed_at ? styles["is-completed"] : ""}
                    onClick={() => openEditForm(task)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className={styles["done-checkbox"]}
                        checked={!!task.completed_at}
                        onChange={() => handleToggleDone(task)}
                        aria-label={task.completed_at ? "Mark incomplete" : "Mark complete"}
                      />
                    </td>
                    <td className={styles["task-title"]}>{task.title}</td>
                    <td className={styles["task-deal"]}>
                      {task.deal ? formatDealLabel(task.deal) : <span className={styles["no-deal"]}>—</span>}
                    </td>
                    <td>
                      {task.context ? (
                        <span className={styles["context-chip"]} style={{ ["--chip-color" as string]: CONTEXT_COLORS[task.context] }}>
                          {task.context}
                        </span>
                      ) : (
                        <span className={styles["no-value"]}>—</span>
                      )}
                    </td>
                    <td>{task.start_date ? formatStartDate(task.start_date) : <span className={styles["no-value"]}>—</span>}</td>
                    <td className={styles["task-duration"]}>
                      {task.duration_hours != null ? formatDuration(task.duration_hours) : <span className={styles["no-value"]}>—</span>}
                    </td>
                    <td>{task.is_next_action && <span className={styles["next-action-badge"]}>★ Next action</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <div
          className={styles["modal-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) closeForm();
          }}
        >
          <div className={styles["modal-panel"]}>
            <div className={styles["modal-head"]}>
              <h2 className={styles["modal-title"]}>{editingTask ? "Edit task" : "Add task"}</h2>
              <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={closeForm} disabled={submitting}>
                ×
              </button>
            </div>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label htmlFor="task-title">Title</label>
                <input
                  id="task-title"
                  required
                  autoFocus
                  autoComplete="off"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="task-deal">Deal</label>
                <select
                  id="task-deal"
                  value={form.deal_id ?? ""}
                  onChange={(e) => {
                    const dealId = e.target.value ? Number(e.target.value) : null;
                    setForm((f) => ({ ...f, deal_id: dealId }));
                    if (dealId == null) setWantsNextAction(false);
                  }}
                >
                  <option value="">No deal</option>
                  {dealOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {formatDealLabel(d)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles["field-row"]}>
                <div className={styles.field}>
                  <label htmlFor="task-context">Context</label>
                  <select
                    id="task-context"
                    value={form.context}
                    onChange={(e) => setForm((f) => ({ ...f, context: e.target.value as TaskContext | "" }))}
                  >
                    <option value="">No context</option>
                    {TASK_CONTEXTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="task-start">Start date</label>
                  <input
                    id="task-start"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label htmlFor="task-duration">Duration (hours)</label>
                <input
                  id="task-duration"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.duration_hours}
                  onChange={(e) => setForm((f) => ({ ...f, duration_hours: e.target.value }))}
                />
              </div>
              <label className={`${styles["next-action-field"]} ${form.deal_id == null ? styles["is-disabled"] : ""}`}>
                <input
                  type="checkbox"
                  checked={wantsNextAction}
                  disabled={form.deal_id == null}
                  onChange={(e) => setWantsNextAction(e.target.checked)}
                />
                Mark as this deal&apos;s next action
              </label>
              {form.deal_id == null && <div className={styles["form-hint"]}>Pick a deal first to set this as its next action.</div>}
              {wantsNextAction && conflictingNextAction && (
                <div className={styles["form-hint"]}>This will replace &quot;{conflictingNextAction.title}&quot; as the next action for this deal.</div>
              )}
              {formError && <div className={styles["form-error"]}>{formError}</div>}
              <div className={styles["form-actions"]}>
                {editingTask ? (
                  <button type="button" className={styles["btn-danger"]} onClick={handleDelete} disabled={submitting}>
                    Delete
                  </button>
                ) : (
                  <span />
                )}
                <div className={styles["form-actions-right"]}>
                  <button type="button" className={styles["btn-cancel"]} onClick={closeForm} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className={styles["btn-submit"]} disabled={submitting || !form.title.trim()}>
                    {submitting ? "Saving…" : editingTask ? "Save" : "Add Task"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={`${styles.toast} ${toast ? styles["is-visible"] : ""}`} role="status" aria-live="polite">
        <span>{toast}</span>
      </div>
    </div>
  );
}
