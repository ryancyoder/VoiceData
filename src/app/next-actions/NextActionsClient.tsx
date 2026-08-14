"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { STAGES, type Stage } from "@/lib/salesBoard";
import { type TaskPhoto, taskPhotoUrl } from "@/lib/tasks";
import { fetchWithTimeout } from "@/lib/withTimeout";
import DealTimeline, { TimelineSortHeader, type TimelineDates, type MilestoneKey } from "./DealTimeline";
import TextTemplateMenu from "../sales-board/TextTemplateMenu";
import styles from "./next-actions.module.css";

// Fire-and-forget: log a call/email/text touchpoint on the deal's
// correspondence when a contact button is used.
function logTouchpoint(dealId: number, channel: "call" | "email" | "text") {
  fetch(`/api/sales-board/${dealId}/correspondence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
  }).catch(() => {});
}

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

// Synonym groups collapse related leading verbs into one action-list chip
// (e.g. "order", "purchase", and "buy" all mean Purchasing). Any verb not in a
// group stands as its own chip.
const VERB_GROUPS: { label: string; verbs: string[] }[] = [
  { label: "Purchasing", verbs: ["order", "purchase", "buy"] },
];

// The leading word of a next action, lowercased and stripped of punctuation.
// Every next action starts with a verb, so this is the action's category.
function leadingVerb(title: string): string {
  return (title.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/[^a-z]/g, "");
}

function groupForVerb(verb: string): { label: string; verbs: string[] } | null {
  return VERB_GROUPS.find((g) => g.verbs.includes(verb)) ?? null;
}

interface ActionChip {
  key: string;
  label: string;
  verbs: Set<string>;
  count: number;
}

// Builds the action-list chips dynamically from the rows in view: one chip per
// leading verb (synonyms merged) that appears more than once, highest count
// first.
function buildActionChips(rows: NextActionRow[], includeLost: boolean): ActionChip[] {
  const byKey = new Map<string, ActionChip>();
  for (const r of rows) {
    if (!includeLost && r.lostAt) continue;
    const verb = leadingVerb(r.nextActionTitle);
    if (!verb) continue;
    const group = groupForVerb(verb);
    const key = group ? group.label : verb;
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      existing.verbs.add(verb);
    } else {
      byKey.set(key, {
        key,
        label: group ? group.label : verb.charAt(0).toUpperCase() + verb.slice(1),
        verbs: new Set(group ? group.verbs : [verb]),
        count: 1,
      });
    }
  }
  return [...byKey.values()]
    .filter((c) => c.count > 1)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface NextActionRow {
  id: number;
  dealName: string;
  stage: Stage;
  lostAt: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  proposalNumber: string | null;
  proposalDescription: string | null;
  nextActionTaskId: number | null;
  nextActionTitle: string;
  nextActionPhotos: TaskPhoto[];
  // The property's ⚡ next-action photo, chosen in the photo gallery. Shown
  // read-only here (managed from the gallery), distinct from the task photos
  // attached directly to the next-action task.
  nextActionMarkedPhoto: { id: number; url: string | null } | null;
  milestoneDates: TimelineDates;
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
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  // "" = every action; otherwise an ACTION_LISTS key (e.g. "call").
  const [actionList, setActionList] = useState("");
  // Row order: grouped by pipeline stage, or a flat alphabetical list.
  const [orderMode, setOrderMode] = useState<"stage" | "alpha">("stage");
  // Sort the whole list by a timeline milestone's date (overrides stage/alpha
  // grouping into a single flat list). Cycles: off → earliest-first → latest-first.
  const [milestoneSort, setMilestoneSort] = useState<{ key: MilestoneKey; dir: "asc" | "desc" } | null>(null);
  function cycleMilestoneSort(key: MilestoneKey) {
    setMilestoneSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }
  // Which stage groups are collapsed (stage order only).
  const [collapsedStages, setCollapsedStages] = useState<Set<Stage>>(new Set());
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

  // Chips are computed over the lost-filtered rows (not the stage/search/chip
  // filters) so the chip set stays stable as you drill in.
  const actionChips = buildActionChips(rows, showLost);
  const activeChip = actionList ? actionChips.find((c) => c.key === actionList) ?? null : null;
  const visibleRows = rows.filter((r) => {
    if (!showLost && r.lostAt) return false;
    if (!stageFilter.has(r.stage)) return false;
    if (missingOnly && r.nextActionTitle.trim()) return false;
    if (activeChip && !activeChip.verbs.has(leadingVerb(r.nextActionTitle))) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = `${r.contactLastName ?? ""} ${r.dealName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // A milestone sort takes over ordering (flat list by that date); otherwise
  // alphabetical sorts by deal name and stage keeps the pipeline ordering.
  const orderedRows = milestoneSort
    ? [...visibleRows].sort((a, b) => {
        const da = a.milestoneDates[milestoneSort.key];
        const db = b.milestoneDates[milestoneSort.key];
        if (!da && !db) return 0;
        if (!da) return 1; // deals without this milestone sink to the bottom
        if (!db) return -1;
        return milestoneSort.dir === "asc" ? da.localeCompare(db) : db.localeCompare(da);
      })
    : orderMode === "alpha"
      ? [...visibleRows].sort((a, b) => a.dealName.localeCompare(b.dealName))
      : visibleRows;

  const groups: { stage: Stage; rows: NextActionRow[] }[] = [];
  for (const row of orderedRows) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.stage === row.stage) lastGroup.rows.push(row);
    else groups.push({ stage: row.stage, rows: [row] });
  }

  // Rows actually on screen — collapsed stage groups render only their header,
  // so their rows aren't navigable. Keyboard nav (focusRow/handleKeyDown) walks
  // this list; indexByRowId maps a row to its position in it.
  const renderedRows =
    orderMode === "stage" && !milestoneSort ? orderedRows.filter((r) => !collapsedStages.has(r.stage)) : orderedRows;
  const indexByRowId = new Map<number, number>(renderedRows.map((row, i) => [row.id, i]));

  const stagesInView = groups.map((g) => g.stage);
  const allCollapsed = stagesInView.length > 0 && stagesInView.every((s) => collapsedStages.has(s));

  // Stage order renders one collapsible group per stage; alphabetical order and
  // a milestone sort are a single headerless flat list.
  const displayGroups: { stage: Stage | null; rows: NextActionRow[] }[] =
    orderMode === "alpha" || milestoneSort ? [{ stage: null, rows: orderedRows }] : groups;

  function toggleStage(stage: Stage) {
    setStageFilter((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  function toggleCollapse(stage: Stage) {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  function toggleCollapseAll() {
    setCollapsedStages(allCollapsed ? new Set() : new Set(stagesInView));
  }

  function focusRow(index: number) {
    const row = renderedRows[index];
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
        <div className={styles["stage-dropdown"]}>
          <button
            type="button"
            className={styles["stage-dropdown-btn"]}
            onClick={() => setStageMenuOpen((o) => !o)}
          >
            {stageFilter.size === STAGES.length
              ? "All stages"
              : stageFilter.size === 0
                ? "No stages"
                : `${stageFilter.size} stages`}{" "}
            ▾
          </button>
          {stageMenuOpen && (
            <>
              <div className={styles["stage-menu-backdrop"]} onClick={() => setStageMenuOpen(false)} />
              <div className={styles["stage-menu"]}>
                <div className={styles["stage-menu-actions"]}>
                  <button type="button" onClick={() => setStageFilter(new Set(STAGES))}>
                    All
                  </button>
                  <button type="button" onClick={() => setStageFilter(new Set())}>
                    None
                  </button>
                </div>
                {STAGES.map((stage) => (
                  <label key={stage} className={styles["stage-menu-item"]}>
                    <input type="checkbox" checked={stageFilter.has(stage)} onChange={() => toggleStage(stage)} />
                    <span className={styles["stage-menu-dot"]} style={{ background: STAGE_COLORS[stage] }} />
                    {stage}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <div className={styles["action-list-filters"]} role="group" aria-label="Action list">
          <button
            type="button"
            className={`${styles["action-list-chip"]} ${actionList === "" ? styles["is-active"] : ""}`}
            onClick={() => setActionList("")}
          >
            All actions
          </button>
          {actionChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`${styles["action-list-chip"]} ${actionList === chip.key ? styles["is-active"] : ""}`}
              onClick={() => setActionList((cur) => (cur === chip.key ? "" : chip.key))}
            >
              {chip.label} <span className={styles["chip-count"]}>{chip.count}</span>
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

      <div className={styles["list-toolbar"]}>
        <div className={styles["order-toggle"]}>
          <button
            type="button"
            className={`${styles["order-btn"]} ${orderMode === "stage" && !milestoneSort ? styles["is-active"] : ""}`}
            onClick={() => { setOrderMode("stage"); setMilestoneSort(null); }}
          >
            Stage
          </button>
          <button
            type="button"
            className={`${styles["order-btn"]} ${orderMode === "alpha" && !milestoneSort ? styles["is-active"] : ""}`}
            onClick={() => { setOrderMode("alpha"); setMilestoneSort(null); }}
          >
            A–Z
          </button>
        </div>
        {orderMode === "stage" && (
          <button type="button" className={styles["collapse-all-btn"]} onClick={toggleCollapseAll}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles["timeline-header-cell"]}>
              <TimelineSortHeader
                sortKey={milestoneSort?.key ?? null}
                sortDir={milestoneSort?.dir ?? "asc"}
                onSort={cycleMilestoneSort}
              />
            </th>
            <th>Deal</th>
            <th>Next Action</th>
            <th>Photos</th>
            <th>Contact</th>
          </tr>
        </thead>
        <tbody>
          {displayGroups.map((group) => {
            const collapsed = group.stage != null && collapsedStages.has(group.stage);
            return (
            <Fragment key={group.stage ?? "__alpha__"}>
              {group.stage != null && (
                <tr className={styles["stage-header-row"]} style={{ ["--row-color" as string]: STAGE_COLORS[group.stage] }}>
                  <td colSpan={5}>
                    <button type="button" className={styles["stage-collapse-btn"]} onClick={() => toggleCollapse(group.stage!)}>
                      <span className={styles["collapse-caret"]}>{collapsed ? "▸" : "▾"}</span>
                      {group.stage} <span className={styles["stage-count"]}>{group.rows.length}</span>
                    </button>
                  </td>
                </tr>
              )}
              {!collapsed && group.rows.map((row) => {
                const index = indexByRowId.get(row.id)!;
                return (
                  <tr key={row.id}>
                    <td className={styles["timeline-cell"]}>
                      <DealTimeline dates={row.milestoneDates} />
                    </td>
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
                    <td className={styles["photos-cell"]}>
                      <div className={styles["photo-strip"]}>
                        {row.nextActionMarkedPhoto?.url && (
                          <a
                            className={`${styles["photo-thumb"]} ${styles["photo-marked"]}`}
                            href={row.nextActionMarkedPhoto.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Next-action photo — set in the photo gallery"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={row.nextActionMarkedPhoto.url} alt="" />
                            <span className={styles["photo-marked-badge"]}>⚡</span>
                          </a>
                        )}
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
                    <td className={styles["contact-cell"]}>
                      <div className={styles["contact-actions"]}>
                        {row.contactPhone?.replace(/[^\d+]/g, "") && (
                          <TextTemplateMenu
                            compact
                            phone={row.contactPhone}
                            tokens={{
                              first_name: row.contactFirstName?.trim() ?? "",
                              last_name: row.contactLastName?.trim() ?? "",
                              proposal_number: row.proposalNumber?.trim() ?? "",
                              proposal_description: row.proposalDescription?.trim() ?? "",
                            }}
                            onSend={() => logTouchpoint(row.id, "text")}
                          />
                        )}
                        {row.contactPhone?.replace(/[^\d+]/g, "") && (
                          <a
                            className={styles["contact-btn"]}
                            title="Call"
                            aria-label="Call"
                            href={`tel:${row.contactPhone.replace(/[^\d+]/g, "")}`}
                            onClick={() => logTouchpoint(row.id, "call")}
                          >
                            📞
                          </a>
                        )}
                        {row.contactEmail?.trim() && (
                          <a
                            className={styles["contact-btn"]}
                            title="Email"
                            aria-label="Email"
                            href={`mailto:${encodeURIComponent(row.contactEmail.trim())}${
                              row.proposalNumber?.trim()
                                ? `?subject=${encodeURIComponent(`Proposal #${row.proposalNumber.trim()}`)}`
                                : ""
                            }`}
                            onClick={() => logTouchpoint(row.id, "email")}
                          >
                            ✉️
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Fragment>
            );
          })}
          {visibleRows.length === 0 && (
            <tr>
              <td colSpan={5} className={styles["empty-row"]}>
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
