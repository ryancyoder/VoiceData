"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { STAGES, type Stage } from "@/lib/salesBoard";
import { type TaskPhoto, taskPhotoUrl } from "@/lib/tasks";
import { fetchWithTimeout } from "@/lib/withTimeout";
import DealTimeline, { type TimelineEvent } from "./DealTimeline";
import styles from "./next-actions.module.css";

const SAVE_TIMEOUT_MS = 15000;

const STAGE_COLORS: Record<Stage, string> = {
  Lead: "var(--c-lead)",
  Propose: "var(--c-propose)",
  Sent: "var(--c-send)",
  Sold: "var(--c-sold)",
  "Project Management": "var(--c-pm)",
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
  nextActionPhotos: TaskPhoto[];
  timelineEvents: TimelineEvent[];
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
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const pasteTargetRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  // Which row's photo cell should claim the next raw paste. State, not a
  // ref, because it also drives whether that row's fallback paste target
  // renders visibly (see isTouchDevice below) — reads happen at low
  // frequency (one per Paste-button click), so there's no perf reason to
  // avoid a render here. Only one row can be armed at a time: clicking a
  // different row's Paste button just overwrites this rather than needing
  // to disarm the previous one first.
  const [armedPasteRowId, setArmedPasteRowId] = useState<number | null>(null);
  // "Press ⌘V" is meaningless on an iPhone/iPad with no physical keyboard,
  // and the fallback paste target is normally hidden off-screen (fine for
  // capturing a real keyboard paste, useless as a touch target) — on a
  // touch device we instead show that target visibly with tap-to-paste
  // instructions. A lazy initializer rather than an effect: this never
  // affects the very first render's output either way (it's only read once
  // a row is armed, which can't happen before mount), so there's no
  // server/client hydration mismatch to guard against here.
  const [isTouchDevice] = useState(() => typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [lightbox, setLightbox] = useState<{ rowId: number; taskId: number; photoId: number; url: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focuses the armed row's fallback paste target once it's actually in
  // the DOM — armPasteTarget() itself only sets state, since the visible
  // variant of this target doesn't exist to focus until after that
  // state's own render commits.
  useEffect(() => {
    if (armedPasteRowId != null) {
      pasteTargetRefs.current[armedPasteRowId]?.focus();
    }
  }, [armedPasteRowId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Alt/Option+K jumps here, deliberately not ⌘K — that's already claimed
  // globally by the command palette (see CommandPalette.tsx), and browsers
  // don't let a page override it anyway. Checked via e.code rather than
  // e.key: on macOS, Option+<letter> types an accented/special character
  // into e.key (it's a dead-key modifier for the OS), so e.key wouldn't
  // reliably be "k" there — e.code stays "KeyK" regardless of modifiers.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.code === "KeyK") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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

  // visibleRows is already sorted by stage (see page.tsx), so rows for the
  // same stage are always contiguous — no need to re-group from scratch.
  const groups: { stage: Stage; rows: NextActionRow[] }[] = [];
  for (const row of visibleRows) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.stage === row.stage) lastGroup.rows.push(row);
    else groups.push({ stage: row.stage, rows: [row] });
  }

  // Keyboard nav (focusRow/handleKeyDown) still operates on the flat
  // visibleRows ordering — this just looks each row's original position up
  // without a mutable counter, which the refs-in-render lint rule dislikes
  // when it's threaded through an inline IIFE in the JSX below.
  const indexByRowId = new Map<number, number>(visibleRows.map((row, i) => [row.id, i]));

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

  // Returns the id of the task this row's next action now lives on (or null
  // if it has none) — used both after a keyboard-driven save and to make
  // sure a task exists before a photo can be attached to it.
  async function commit(rowId: number): Promise<number | null> {
    const draft = draftsRef.current[rowId];
    const row = rows.find((r) => r.id === rowId);
    if (draft === undefined) return row?.nextActionTaskId ?? null;
    clearDraft(rowId);
    if (!row) return null;

    const trimmed = draft.trim();
    if (trimmed === row.nextActionTitle.trim()) return row.nextActionTaskId;

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
        window.dispatchEvent(new Event("tasks:changed"));
        return null;
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
        window.dispatchEvent(new Event("tasks:changed"));
        return row.nextActionTaskId;
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
        window.dispatchEvent(new Event("tasks:changed"));
        return data.task.id as number;
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save next action");
      return null;
    } finally {
      setSaving((s) => {
        const next = { ...s };
        delete next[rowId];
        return next;
      });
    }
  }

  // Deliberately left unmemoized, matching every other handler in this file
  // (commit, deletePhoto, handlePasteClick) — the paste-listener effect
  // below re-subscribing whenever this identity changes is harmless.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  async function attachPhoto(rowId: number, file: File) {
    // commit() first — if there's unsaved text this creates the task from
    // it, and if the row already has a saved next action it's a no-op that
    // just returns the existing task id.
    const taskId = await commit(rowId);
    if (taskId == null) {
      showToast("Add a next action before attaching a photo");
      return;
    }

    setUploading((u) => ({ ...u, [rowId]: true }));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetchWithTimeout(`/api/tasks/${taskId}/photos`, { method: "POST", body: formData }, SAVE_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to attach photo");
      setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, nextActionPhotos: [...r.nextActionPhotos, data.photo] } : r)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to attach photo");
    } finally {
      setUploading((u) => {
        const next = { ...u };
        delete next[rowId];
        return next;
      });
    }
  }

  function armPasteTarget(rowId: number) {
    setArmedPasteRowId(rowId);
  }

  // On a touch device there's no keyboard shortcut to press, and the
  // fallback target is shown visibly there (see the textarea below) so it
  // can be tapped-and-held for the OS's native Paste menu instead.
  function fallbackPasteMessage() {
    return isTouchDevice ? "Tap the box that appeared below, then tap Paste" : "Press ⌘V / Ctrl+V now to paste";
  }

  async function handlePasteClick(rowId: number) {
    if (!navigator.clipboard?.read) {
      showToast(fallbackPasteMessage());
      armPasteTarget(rowId);
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const clipboardItem of clipboardItems) {
        const usableType = clipboardItem.types.find((type) => type.startsWith("image/"));
        if (!usableType) continue;
        const blob = await clipboardItem.getType(usableType);
        const ext = usableType.split("/")[1] || "png";
        // Only used to make the synthetic filename unique — this runs
        // inside a click handler, never during render, despite the lint
        // rule's static analysis flagging it (it's more conservative about
        // calls reachable through an inline arrow closure than one passed
        // by direct reference).
        // eslint-disable-next-line react-hooks/purity
        files.push(new File([blob], `pasted-${Date.now()}.${ext}`, { type: usableType }));
      }
      if (files.length === 0) {
        // navigator.clipboard.read() only exposes a narrow, browser-defined
        // allowlist of MIME types — an image the OS clipboard holds in a
        // format outside that allowlist never shows up here. Arming the
        // fallback target and prompting a real paste is the reliable
        // fallback: it triggers the browser's native paste event, which
        // isn't bound by that allowlist.
        showToast(fallbackPasteMessage());
        armPasteTarget(rowId);
        return;
      }
      for (const file of files) await attachPhoto(rowId, file);
    } catch {
      showToast(fallbackPasteMessage());
      armPasteTarget(rowId);
    }
  }

  // A single shared listener rather than one per row — with potentially
  // dozens of rows, only whichever one is explicitly armed (its own Paste
  // button was just clicked) should ever claim a raw paste; an untargeted
  // paste is silently ignored rather than guessing which row it was meant
  // for.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (armedPasteRowId == null) return;
      const rowId = armedPasteRowId;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length === 0) {
        showToast("No image found in what was pasted");
        return;
      }
      e.preventDefault();
      setArmedPasteRowId(null);
      files.forEach((file) => attachPhoto(rowId, file));
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [attachPhoto, armedPasteRowId]);

  async function deletePhoto(rowId: number, taskId: number, photoId: number) {
    try {
      const res = await fetchWithTimeout(`/api/tasks/${taskId}/photos/${photoId}`, { method: "DELETE" }, SAVE_TIMEOUT_MS);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete photo");
      }
      setRows((rs) =>
        rs.map((r) => (r.id === rowId ? { ...r, nextActionPhotos: r.nextActionPhotos.filter((p) => p.id !== photoId) } : r))
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete photo");
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
          ref={searchInputRef}
          type="text"
          placeholder="Search contact or deal… (⌥K)"
          title="Jump here with Option+K / Alt+K"
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
            <th>Timeline</th>
            <th>Photos</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.stage}>
              <tr className={styles["stage-header-row"]} style={{ ["--row-color" as string]: STAGE_COLORS[group.stage] }}>
                <td colSpan={4}>
                  {group.stage} <span className={styles["stage-count"]}>{group.rows.length}</span>
                </td>
              </tr>
              {group.rows.map((row) => {
                const index = indexByRowId.get(row.id)!;
                return (
                  <tr key={row.id}>
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
                    <td className={styles["timeline-cell"]}>
                      <DealTimeline events={row.timelineEvents} />
                    </td>
                    <td className={styles["photos-cell"]}>
                      <div className={styles["photo-strip"]}>
                        {row.nextActionPhotos.map((photo) => (
                          <button
                            key={photo.id}
                            type="button"
                            className={styles["photo-thumb"]}
                            onClick={() =>
                              setLightbox({
                                rowId: row.id,
                                taskId: row.nextActionTaskId!,
                                photoId: photo.id,
                                url: taskPhotoUrl(photo.storage_path),
                              })
                            }
                            title={photo.file_name ?? "View photo"}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={taskPhotoUrl(photo.storage_path)} alt="" />
                          </button>
                        ))}
                        <button
                          type="button"
                          className={styles["photo-add"]}
                          disabled={!!uploading[row.id]}
                          title="Take a photo"
                          onClick={() => fileInputRefs.current[row.id]?.click()}
                        >
                          {uploading[row.id] ? "…" : "+"}
                        </button>
                        <input
                          ref={(el) => {
                            fileInputRefs.current[row.id] = el;
                          }}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className={styles["photo-file-input"]}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) attachPhoto(row.id, file);
                          }}
                        />
                        <button
                          type="button"
                          className={styles["photo-paste"]}
                          disabled={!!uploading[row.id]}
                          title="Paste a screenshot from clipboard"
                          onClick={() => handlePasteClick(row.id)}
                        >
                          📋
                        </button>
                        <textarea
                          ref={(el) => {
                            pasteTargetRefs.current[row.id] = el;
                          }}
                          className={
                            armedPasteRowId === row.id && isTouchDevice
                              ? styles["photo-paste-target-visible"]
                              : styles["photo-paste-target"]
                          }
                          placeholder={armedPasteRowId === row.id && isTouchDevice ? "Tap, then Paste" : undefined}
                          aria-hidden={!(armedPasteRowId === row.id && isTouchDevice)}
                          tabIndex={armedPasteRowId === row.id && isTouchDevice ? 0 : -1}
                          value=""
                          onChange={() => {}}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
          {visibleRows.length === 0 && (
            <tr>
              <td colSpan={4} className={styles["empty-row"]}>
                No deals match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className={`${styles.toast} ${toast ? styles["is-visible"] : ""}`} role="status" aria-live="polite">
        <span>{toast}</span>
      </div>

      {lightbox && (
        <div
          className={styles.lightbox}
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightbox(null);
          }}
        >
          <div className={styles["lightbox-content"]}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt="" />
            <div className={styles["lightbox-actions"]}>
              <button
                type="button"
                className={styles["lightbox-delete"]}
                onClick={() => {
                  deletePhoto(lightbox.rowId, lightbox.taskId, lightbox.photoId);
                  setLightbox(null);
                }}
              >
                Delete
              </button>
              <button type="button" className={styles["lightbox-close"]} onClick={() => setLightbox(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
