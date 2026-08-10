"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { STAGE_COLORS, type PlanningBlock } from "@/lib/planning/blocks";
import type { ForecastDeal } from "@/lib/planning/schedule";
import { computeBoard, type Placement, type BoardDealRow } from "@/lib/planning/board";
import { STAGES, type Stage } from "@/lib/salesBoard";
import styles from "./planner.module.css";

const PX_PER_DAY = 26;
const ROW_H = 40;
const AXIS_H = 36;
// Bands and tiles fill 50% of the row height, centered (25% padding top/bottom).
const BAND_H = ROW_H * 0.5;
const BAND_PAD = (ROW_H - BAND_H) / 2;
const HORIZONS = [4, 8, 12, 26];

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(a: string, b: string): number {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86400000);
}
function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtTick(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface StageWindow {
  offset: number;
  px: number; // left pixel under the non-uniform time scale
  blockId: string;
  date: string;
}

// Per-deal stage-transition dates that drive the row's stage-history band.
export interface DealStageDates {
  dealId: number;
  rfp: string | null; // Lead begins
  appointment: string | null; // → Propose
  proposal: string | null; // → Sent
  won: string | null; // → Sold
  start: string | null; // → Project Management (production start)
  end: string | null; // production end
}

// The stage a deal is in during each span, keyed to the date that span begins.
const BAND_STAGE_ORDER: { stage: Stage; key: keyof DealStageDates }[] = [
  { stage: "Lead", key: "rfp" },
  { stage: "Propose", key: "appointment" },
  { stage: "Sent", key: "proposal" },
  { stage: "Sold", key: "won" },
  { stage: "Project Management", key: "start" },
];

interface StageSegment {
  stage: Stage;
  start: string; // inclusive
  endEx: string; // exclusive
}

// Turn a deal's transition dates into colored spans. Each stage runs from its
// own date until the next defined transition; the last known stage runs to today
// (still ongoing). Two special cases: Project Management runs to the production
// end date, and Sold always runs from the won date through yesterday (won →
// today-exclusive), regardless of when production is scheduled. Zero/negative-
// width spans are dropped.
function buildSegments(d: DealStageDates, today: string): StageSegment[] {
  const seq = BAND_STAGE_ORDER.map((o) => ({ stage: o.stage, date: d[o.key] as string | null })).filter(
    (p): p is { stage: Stage; date: string } => !!p.date
  );
  const segs: StageSegment[] = [];
  for (let i = 0; i < seq.length; i++) {
    const cur = seq[i];
    const endEx =
      cur.stage === "Project Management"
        ? d.end
          ? addDays(d.end, 1)
          : addDays(today, 1)
        : cur.stage === "Sold"
          ? today // ends yesterday (today is exclusive)
          : seq[i + 1]?.date ?? addDays(today, 1);
    if (endEx > cur.date) segs.push({ stage: cur.stage, start: cur.date, endEx });
  }
  return segs;
}

async function patchPlacement(dealId: number, blockId: string, date: string, position: number) {
  await fetch(`/api/planning/placements/${dealId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blockId, date, position }),
  }).catch(() => {});
}

export default function PlannerClient({
  blocks,
  deals,
  initialDefaults,
  initialPlacements,
  stageDates,
}: {
  blocks: PlanningBlock[];
  deals: ForecastDeal[];
  initialDefaults: Record<string, number>;
  initialPlacements: Placement[];
  stageDates: DealStageDates[];
}) {
  const [horizonWeeks, setHorizonWeeks] = useState(12);
  const [today] = useState(todayKey);
  const [placements, setPlacements] = useState<Map<number, Placement>>(() => {
    const m = new Map<number, Placement>();
    for (const p of initialPlacements) m.set(p.dealId, p);
    return m;
  });
  // Filter bar: which stages to show, and whether to restrict to deals whose
  // stage has planning blocks (the schedulable view this page used to show).
  const [stageFilter, setStageFilter] = useState<Set<Stage>>(() => new Set(STAGES));
  const [blocksOnly, setBlocksOnly] = useState(false);
  function toggleStage(s: Stage) {
    setStageFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const board = useMemo(
    () => computeBoard(blocks, deals, initialDefaults, placements, { todayKey: today, horizonWeeks }),
    [blocks, deals, initialDefaults, placements, today, horizonWeeks]
  );

  const datesById = useMemo(() => {
    const m = new Map<number, DealStageDates>();
    for (const d of stageDates) m.set(d.dealId, d);
    return m;
  }, [stageDates]);

  type Row = BoardDealRow & { stage: Stage; color: string };

  // Rows from the scheduler (deals whose stage has planning blocks) …
  const boardRows: Row[] = board.stages.flatMap((s) => s.rows.map((r) => ({ ...r, stage: s.stage, color: s.color })));
  const stagesWithBlocks = new Set<Stage>(board.stages.map((s) => s.stage));
  const scheduledIds = new Set(boardRows.map((r) => r.dealId));
  // … plus a plain row for every other active deal (no block windows to snap
  // to — shown for its stage-history band only).
  const extraRows: Row[] = deals
    .filter((d) => !scheduledIds.has(d.id))
    .map((d) => ({
      dealId: d.id,
      name: d.name,
      company: d.company,
      hours: d.estimatedHours ?? initialDefaults[d.stage] ?? 0,
      orderDate: d.orderDate,
      placement: null,
      issue: null,
      stage: d.stage,
      color: STAGE_COLORS[d.stage],
    }));
  const allRows: Row[] = [...boardRows, ...extraRows].sort((a, b) => {
    const ad = a.placement?.date ?? "9999-99-99";
    const bd = b.placement?.date ?? "9999-99-99";
    return ad === bd ? a.orderDate.localeCompare(b.orderDate) : ad.localeCompare(bd);
  });

  // Apply the filter bar: stage chips + "blocks only".
  const rows = allRows.filter((r) => stageFilter.has(r.stage) && (!blocksOnly || stagesWithBlocks.has(r.stage)));
  const fullHeight = AXIS_H + Math.max(1, rows.length) * ROW_H;

  // The timeline's left edge is pulled back to the earliest stage-history date
  // among the visible deals, so each row's history band is visible (not just the
  // today-forward scheduling range). Everything is measured from this origin.
  const rangeStart = rows.reduce((min, r) => {
    const dd = datesById.get(r.dealId);
    if (!dd) return min;
    const cand = [dd.rfp, dd.appointment, dd.proposal, dd.won, dd.start, dd.end].filter((x): x is string => !!x);
    return cand.reduce((m, k) => (k < m ? k : m), min);
  }, today);
  const todayOffset = daysBetween(rangeStart, today);

  // Non-uniform time scale: the past is compressed to weekly resolution (a whole
  // week occupies one day's width) so history stays compact, while the present
  // and future run at full daily resolution so the forecast has room to breathe.
  const PAST_PX_PER_DAY = PX_PER_DAY / 7;
  const pastWidth = todayOffset * PAST_PX_PER_DAY;
  // Left pixel of the day that is `offset` days from rangeStart.
  const xOf = (offset: number) =>
    Math.min(offset, todayOffset) * PAST_PX_PER_DAY + Math.max(0, offset - todayOffset) * PX_PER_DAY;

  // Forward end: today → last block window (min 2 weeks), capped at the horizon.
  const lastWindow = board.stages
    .flatMap((s) => s.windows.map((w) => w.date))
    .reduce((mx, d) => (d > mx ? d : mx), today);
  const minEnd = addDays(today, 13);
  const rangeEnd = lastWindow > minEnd ? lastWindow : minEnd;
  const endKey = rangeEnd > board.horizonEnd ? board.horizonEnd : rangeEnd;
  const totalDays = daysBetween(rangeStart, endKey) + 1;
  const innerWidth = xOf(totalDays);
  const ticks = Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => ({
    offset: i * 7,
    label: fmtTick(addDays(rangeStart, i * 7)),
  }));

  // Per-day columns (day-of-month numbers) and the month segments above them.
  const days = Array.from({ length: totalDays }, (_, i) => {
    const key = addDays(rangeStart, i);
    const [y, m, d] = key.split("-").map(Number);
    return {
      offset: i,
      key,
      dayOfMonth: d,
      monthKey: `${y}-${m}`,
      monthLabel: `${String(m).padStart(2, "0")}/${String(y).slice(-2)}`,
    };
  });
  // Day-of-month labels: one per day in the uncompressed present/future, but only
  // weekly in the compressed past (per-day would overlap).
  const dayMarks = days.filter((d) => d.offset >= todayOffset || d.offset % 7 === 0);
  const monthSegments = days
    .filter((d, i) => i === 0 || days[i - 1].monthKey !== d.monthKey)
    .map((d) => ({ key: d.monthKey, offset: d.offset, label: d.monthLabel }));

  // Valid drop targets (block windows) per stage, in the visible range, each with
  // its pixel position under the non-uniform scale. (Plain const — the React
  // Compiler memoizes it; a manual useMemo over derived-const deps can't be
  // preserved.)
  const windowsByStage: Map<string, StageWindow[]> = (() => {
    const m = new Map<string, StageWindow[]>();
    for (const s of board.stages) {
      m.set(
        s.stage,
        s.windows
          .map((w) => {
            const offset = daysBetween(rangeStart, w.date);
            return { offset, px: xOf(offset), blockId: w.blockId, date: w.date };
          })
          .filter((w) => w.offset >= 0 && w.offset < totalDays)
      );
    }
    return m;
  })();

  // ── Drag to reschedule (snap to the deal's stage block windows) ───────────
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    dealId: number;
    windows: StageWindow[];
    rect: DOMRect;
    targetIdx: number;
    moved: boolean;
    ctrl: AbortController;
  } | null>(null);
  // guides / targetPx are in pixels (the non-uniform scale means offsets no
  // longer map linearly to x).
  const [drag, setDrag] = useState<{ dealId: number; color: string; guides: number[]; targetPx: number } | null>(null);

  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const x = e.clientX - d.rect.left;
    let best = 0;
    let bestDist = Infinity;
    d.windows.forEach((w, i) => {
      const dist = Math.abs(w.px + PX_PER_DAY / 2 - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    d.targetIdx = best;
    d.moved = true;
    setDrag((prev) => (prev ? { ...prev, targetPx: d.windows[best].px } : prev));
  }, []);

  const onDragUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    d?.ctrl.abort(); // removes both window listeners
    setDrag(null);
    if (d && d.moved && d.targetIdx >= 0) {
      const w = d.windows[d.targetIdx];
      setPlacements((prev) => {
        const m = new Map(prev);
        m.set(d.dealId, { dealId: d.dealId, blockId: w.blockId, date: w.date, position: 0 });
        return m;
      });
      patchPlacement(d.dealId, w.blockId, w.date, 0);
    }
  }, []);

  function beginDrag(
    e: React.PointerEvent,
    row: { dealId: number; stage: string; color: string; placement: { date: string } | null }
  ) {
    const innerEl = innerRef.current;
    if (!innerEl) return;
    const windows = windowsByStage.get(row.stage) ?? [];
    if (windows.length === 0) return;
    const ctrl = new AbortController();
    dragRef.current = { dealId: row.dealId, windows, rect: innerEl.getBoundingClientRect(), targetIdx: -1, moved: false, ctrl };
    setDrag({
      dealId: row.dealId,
      color: row.color,
      guides: windows.map((w) => w.px),
      targetPx: row.placement ? xOf(daysBetween(rangeStart, row.placement.date)) : pastWidth,
    });
    window.addEventListener("pointermove", onDragMove, { signal: ctrl.signal });
    window.addEventListener("pointerup", onDragUp, { signal: ctrl.signal });
    e.preventDefault();
  }

  function resetDeal(dealId: number) {
    setPlacements((prev) => {
      const m = new Map(prev);
      m.delete(dealId);
      return m;
    });
    fetch(`/api/planning/placements/${dealId}`, { method: "DELETE" }).catch(() => {});
  }

  function resetAll() {
    setPlacements(new Map());
    fetch("/api/planning/placements", { method: "DELETE" }).catch(() => {});
  }

  // Shift every placed deal in a stage by one block window (group move).
  function shiftStage(stage: string, dir: 1 | -1) {
    const windows = windowsByStage.get(stage) ?? [];
    if (windows.length === 0) return;
    const idxByKey = new Map(windows.map((w, i) => [`${w.blockId}|${w.date}`, i]));
    const stageRows = board.stages.find((s) => s.stage === stage)?.rows ?? [];
    const updates: { dealId: number; w: StageWindow }[] = [];
    for (const r of stageRows) {
      if (!r.placement) continue;
      const cur = idxByKey.get(`${r.placement.blockId}|${r.placement.date}`);
      if (cur == null) continue;
      const t = Math.min(windows.length - 1, Math.max(0, cur + dir));
      if (t !== cur) updates.push({ dealId: r.dealId, w: windows[t] });
    }
    if (updates.length === 0) return;
    setPlacements((prev) => {
      const m = new Map(prev);
      for (const u of updates) m.set(u.dealId, { dealId: u.dealId, blockId: u.w.blockId, date: u.w.date, position: 0 });
      return m;
    });
    for (const u of updates) patchPlacement(u.dealId, u.w.blockId, u.w.date, 0);
  }

  const pinnedCount = placements.size;

  return (
    <div className={styles.planner}>
      <div className={styles.header}>
        <div>
          <h1>Planner</h1>
          <p>
            Drag a deal to snap it into a block window of its stage. Solid = pinned, hatched = auto. Use ◀ ▶ in the
            legend to shift a whole stage.
          </p>
        </div>
        <div className={styles.controls}>
          {pinnedCount > 0 && (
            <button type="button" className={styles.resetAll} onClick={resetAll}>
              Reset all to auto
            </button>
          )}
          <label className={styles.horizon}>
            Horizon
            <select value={horizonWeeks} onChange={(e) => setHorizonWeeks(Number(e.target.value))}>
              {HORIZONS.map((w) => (
                <option key={w} value={w}>
                  {w} weeks
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {deals.length === 0 ? (
        <div className={styles.empty}>No active deals yet.</div>
      ) : (
        <>
          <div className={styles.filterBar}>
            {STAGES.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.filterChip} ${stageFilter.has(s) ? styles.filterOn : ""}`}
                style={{ ["--chip-color" as string]: STAGE_COLORS[s] }}
                onClick={() => toggleStage(s)}
                title={`Show/hide ${s} deals`}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              className={`${styles.filterChip} ${styles.blocksChip} ${blocksOnly ? styles.filterOn : ""}`}
              onClick={() => setBlocksOnly((v) => !v)}
              title="Show only deals whose stage has planning blocks (the schedulable view)"
            >
              Blocks only
            </button>
          </div>

          {board.stages.length > 0 && (
            <div className={styles.legend}>
            {board.stages.map((s) => (
              <span key={s.stage} className={styles.legendItem} style={{ ["--stage-color" as string]: s.color }}>
                <button type="button" className={styles.shiftBtn} onClick={() => shiftStage(s.stage, -1)} title={`Shift ${s.stage} earlier`}>
                  ◀
                </button>
                <span className={styles.legendDot} />
                {s.stage}
                <button type="button" className={styles.shiftBtn} onClick={() => shiftStage(s.stage, 1)} title={`Shift ${s.stage} later`}>
                  ▶
                </button>
              </span>
            ))}
            </div>
          )}

          <div className={styles.board}>
            <div className={styles.scroll}>
              <div ref={innerRef} className={styles.inner} style={{ width: innerWidth, height: fullHeight }}>
                {/* Stage-history bands (row backgrounds): each deal's time in a
                    stage, colored by the stage. Behind the grid and drag rows. */}
                {rows.map((r, i) => {
                  const dd = datesById.get(r.dealId);
                  if (!dd) return null;
                  return buildSegments(dd, today).map((seg, si) => {
                    const from = Math.max(0, daysBetween(rangeStart, seg.start));
                    const to = Math.min(totalDays, daysBetween(rangeStart, seg.endEx));
                    if (to <= from) return null;
                    return (
                      <div
                        key={`sb${r.dealId}-${si}`}
                        className={styles.stageBand}
                        style={{
                          left: xOf(from),
                          width: xOf(to) - xOf(from),
                          top: AXIS_H + i * ROW_H + BAND_PAD,
                          height: BAND_H,
                          ["--band-color" as string]: STAGE_COLORS[seg.stage],
                        }}
                        title={`${r.name} · ${seg.stage}`}
                      />
                    );
                  });
                })}
                {rows.map((r, i) => (
                  <div
                    key={`bg${r.dealId}`}
                    className={styles.ganttRow}
                    style={{ top: AXIS_H + i * ROW_H, width: innerWidth, height: ROW_H }}
                    onPointerDown={(e) => beginDrag(e, r)}
                    title={`${r.name} — drag anywhere on this row to reschedule`}
                  />
                ))}
                {/* Light day separators — only in the uncompressed present/future. */}
                {Array.from({ length: totalDays + 1 }, (_, i) => i)
                  .filter((off) => off >= todayOffset)
                  .map((off) => (
                    <div key={`d${off}`} className={styles.dayGrid} style={{ left: xOf(off), height: fullHeight }} />
                  ))}
                {/* Darker weekly separators — across the whole range (the primary
                    gridlines in the compressed past). */}
                {ticks.map((t) => (
                  <div key={`g${t.offset}`} className={styles.grid} style={{ left: xOf(t.offset), height: fullHeight }} />
                ))}
                {/* drop-target guides while dragging */}
                {drag &&
                  drag.guides.map((px) => (
                    <div
                      key={`gd${px}`}
                      className={`${styles.dropGuide} ${px === drag.targetPx ? styles.dropTarget : ""}`}
                      style={{ left: px, width: PX_PER_DAY, top: AXIS_H, height: fullHeight - AXIS_H, ["--stage-color" as string]: drag.color }}
                    />
                  ))}
                <div className={styles.today} style={{ left: pastWidth, height: fullHeight }} />
                <div className={styles.axis} style={{ height: AXIS_H }}>
                  {monthSegments.map((m) => (
                    <span key={m.key} className={styles.monthLabel} style={{ left: xOf(m.offset) + 3 }}>
                      {m.label}
                    </span>
                  ))}
                  {dayMarks.map((d) => (
                    <span
                      key={`dn${d.offset}`}
                      className={`${styles.dayNum} ${d.key === today ? styles.dayNumToday : ""}`}
                      style={{ left: xOf(d.offset), width: PX_PER_DAY }}
                    >
                      {d.dayOfMonth}
                    </span>
                  ))}
                </div>
                {/* deal labels: left edge at the scheduled date, colored by stage */}
                {rows.map((r, i) => {
                  // Project Management deals aren't block-backed — instead of a
                  // point chip they show as a solid tile spanning their
                  // production window (start → end day).
                  const pmDates = datesById.get(r.dealId);
                  if (r.stage === "Project Management" && pmDates?.start) {
                    const end = pmDates.end && pmDates.end >= pmDates.start ? pmDates.end : pmDates.start;
                    const from = Math.max(0, daysBetween(rangeStart, pmDates.start));
                    const to = Math.min(totalDays, daysBetween(rangeStart, end) + 1);
                    if (to <= from) return null;
                    const tileLeft = xOf(from);
                    const tileRight = xOf(to);
                    const title = `${r.name} · Project Management · ${fmtTick(pmDates.start)} – ${fmtTick(end)}`;
                    return (
                      <Fragment key={r.dealId}>
                        <div
                          className={styles.pmTile}
                          style={{ ["--stage-color" as string]: r.color, left: tileLeft, width: tileRight - tileLeft, top: AXIS_H + i * ROW_H + BAND_PAD, height: BAND_H }}
                          title={title}
                        />
                        {/* Name sits to the right of the tile so it's never clipped. */}
                        <span
                          className={styles.pmTileName}
                          style={{ left: tileRight + 6, top: AXIS_H + i * ROW_H, height: ROW_H }}
                          title={title}
                        >
                          {r.name}
                        </span>
                      </Fragment>
                    );
                  }
                  const placed = !!r.placement;
                  const isDragging = drag?.dealId === r.dealId;
                  const offset = placed ? daysBetween(rangeStart, r.placement!.date) : todayOffset;
                  if (!isDragging && placed && (offset < 0 || offset >= totalDays)) return null;
                  const left = isDragging ? drag!.targetPx : xOf(offset);
                  const chipCls = r.issue ? styles.chipIssue : r.placement?.manual ? styles.chipPinned : styles.chipAuto;
                  const issueLabel =
                    r.issue === "needsEstimate"
                      ? "needs estimate"
                      : r.issue === "oversized"
                        ? "too big for a block"
                        : r.issue === "unplaced"
                          ? "no room in horizon"
                          : "";
                  return (
                    <div
                      key={r.dealId}
                      className={`${styles.item} ${isDragging ? styles.itemDragging : ""}`}
                      style={{ ["--stage-color" as string]: r.color, left, top: AXIS_H + i * ROW_H + 3, height: ROW_H - 6 }}
                      onPointerDown={(e) => beginDrag(e, r)}
                      title={
                        placed
                          ? `${r.name} · ${r.stage} · ${r.hours}h · ${fmtTick(r.placement!.date)}${r.placement!.manual ? " (pinned)" : " (auto)"} — drag to move`
                          : `${r.name} · ${r.stage} · ${issueLabel} — drag onto a block`
                      }
                    >
                      <span className={chipCls} />
                      <span className={`${styles.itemName} ${r.issue ? styles.nameIssue : r.placement?.manual ? "" : styles.nameAuto}`}>
                        {r.name}
                      </span>
                      <span className={r.issue ? styles.itemIssueTag : styles.itemMeta}>
                        {r.issue ? issueLabel : `${r.hours}h`}
                      </span>
                      {r.placement?.manual && (
                        <button
                          type="button"
                          className={styles.resetBtn}
                          title="Reset to auto"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            resetDeal(r.dealId);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
