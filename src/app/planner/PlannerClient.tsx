"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PlanningBlock } from "@/lib/planning/blocks";
import type { ForecastDeal } from "@/lib/planning/schedule";
import { computeBoard, type Placement } from "@/lib/planning/board";
import styles from "./planner.module.css";

const PX_PER_DAY = 26;
const ROW_H = 26;
const AXIS_H = 24;
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
  blockId: string;
  date: string;
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
}: {
  blocks: PlanningBlock[];
  deals: ForecastDeal[];
  initialDefaults: Record<string, number>;
  initialPlacements: Placement[];
}) {
  const [horizonWeeks, setHorizonWeeks] = useState(12);
  const [today] = useState(todayKey);
  const [placements, setPlacements] = useState<Map<number, Placement>>(() => {
    const m = new Map<number, Placement>();
    for (const p of initialPlacements) m.set(p.dealId, p);
    return m;
  });

  const board = useMemo(
    () => computeBoard(blocks, deals, initialDefaults, placements, { todayKey: today, horizonWeeks }),
    [blocks, deals, initialDefaults, placements, today, horizonWeeks]
  );

  // Axis range: today → last block window (min 2 weeks), capped at the horizon.
  const lastWindow = board.stages
    .flatMap((s) => s.windows.map((w) => w.date))
    .reduce((mx, d) => (d > mx ? d : mx), today);
  const minEnd = addDays(today, 13);
  const rangeEnd = lastWindow > minEnd ? lastWindow : minEnd;
  const endKey = rangeEnd > board.horizonEnd ? board.horizonEnd : rangeEnd;
  const totalDays = daysBetween(today, endKey) + 1;
  const innerWidth = totalDays * PX_PER_DAY;
  const ticks = Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => ({
    offset: i * 7,
    label: fmtTick(addDays(today, i * 7)),
  }));

  // Valid drop targets (block windows) per stage, in the visible range.
  const windowsByStage = useMemo(() => {
    const m = new Map<string, StageWindow[]>();
    for (const s of board.stages) {
      m.set(
        s.stage,
        s.windows
          .map((w) => ({ offset: daysBetween(today, w.date), blockId: w.blockId, date: w.date }))
          .filter((w) => w.offset >= 0 && w.offset < totalDays)
      );
    }
    return m;
  }, [board, today, totalDays]);

  const allRows = board.stages
    .flatMap((s) => s.rows.map((r) => ({ ...r, stage: s.stage, color: s.color })))
    .sort((a, b) => {
      const ad = a.placement?.date ?? "9999-99-99";
      const bd = b.placement?.date ?? "9999-99-99";
      return ad === bd ? a.orderDate.localeCompare(b.orderDate) : ad.localeCompare(bd);
    });
  const fullHeight = AXIS_H + Math.max(1, allRows.length) * ROW_H;

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
  const [drag, setDrag] = useState<{ dealId: number; color: string; guides: number[]; targetOffset: number } | null>(null);

  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const x = e.clientX - d.rect.left;
    let best = 0;
    let bestDist = Infinity;
    d.windows.forEach((w, i) => {
      const dist = Math.abs(w.offset * PX_PER_DAY + PX_PER_DAY / 2 - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    d.targetIdx = best;
    d.moved = true;
    setDrag((prev) => (prev ? { ...prev, targetOffset: d.windows[best].offset } : prev));
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
      guides: windows.map((w) => w.offset),
      targetOffset: row.placement ? daysBetween(today, row.placement.date) : 0,
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

      {board.stages.length === 0 ? (
        <div className={styles.empty}>
          No planning blocks yet. Add blocks on the <a href="/calendar">calendar</a> to build a schedule.
        </div>
      ) : (
        <>
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

          <div className={styles.board}>
            <div className={styles.scroll}>
              <div ref={innerRef} className={styles.inner} style={{ width: innerWidth, height: fullHeight }}>
                {allRows.map((r, i) => (
                  <div
                    key={`bg${r.dealId}`}
                    className={styles.ganttRow}
                    style={{ top: AXIS_H + i * ROW_H, width: innerWidth, height: ROW_H }}
                  />
                ))}
                {ticks.map((t) => (
                  <div key={`g${t.offset}`} className={styles.grid} style={{ left: t.offset * PX_PER_DAY, height: fullHeight }} />
                ))}
                {/* drop-target guides while dragging */}
                {drag &&
                  drag.guides.map((off) => (
                    <div
                      key={`gd${off}`}
                      className={`${styles.dropGuide} ${off === drag.targetOffset ? styles.dropTarget : ""}`}
                      style={{ left: off * PX_PER_DAY, width: PX_PER_DAY, top: AXIS_H, height: fullHeight - AXIS_H, ["--stage-color" as string]: drag.color }}
                    />
                  ))}
                <div className={styles.today} style={{ height: fullHeight }} />
                <div className={styles.axis} style={{ height: AXIS_H }}>
                  {ticks.map((t) => (
                    <span key={`t${t.offset}`} className={styles.tick} style={{ left: t.offset * PX_PER_DAY + 4 }}>
                      {t.offset === 0 ? "Today" : t.label}
                    </span>
                  ))}
                </div>
                {/* deal labels: left edge at the scheduled date, colored by stage */}
                {allRows.map((r, i) => {
                  const placed = !!r.placement;
                  const isDragging = drag?.dealId === r.dealId;
                  const offset = isDragging ? drag!.targetOffset : placed ? daysBetween(today, r.placement!.date) : 0;
                  if (!isDragging && placed && (offset < 0 || offset >= totalDays)) return null;
                  const left = offset * PX_PER_DAY;
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
