"use client";

import { useMemo, useState } from "react";
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

  const placementMap = useMemo(() => {
    const m = new Map<number, Placement>();
    for (const p of initialPlacements) m.set(p.dealId, p);
    return m;
  }, [initialPlacements]);

  const board = useMemo(
    () => computeBoard(blocks, deals, initialDefaults, placementMap, { todayKey: today, horizonWeeks }),
    [blocks, deals, initialDefaults, placementMap, today, horizonWeeks]
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

  // All deals from every stage on one chart, ordered chronologically by their
  // scheduled date (unplaced sink to the end); each keeps its stage color.
  const allRows = board.stages
    .flatMap((s) => s.rows.map((r) => ({ ...r, stage: s.stage, color: s.color })))
    .sort((a, b) => {
      const ad = a.placement?.date ?? "9999-99-99";
      const bd = b.placement?.date ?? "9999-99-99";
      return ad === bd ? a.orderDate.localeCompare(b.orderDate) : ad.localeCompare(bd);
    });
  const fullHeight = AXIS_H + Math.max(1, allRows.length) * ROW_H;

  return (
    <div className={styles.planner}>
      <div className={styles.header}>
        <div>
          <h1>Planner</h1>
          <p>
            Each deal on a timeline, seeded from the auto-forecast. Solid = pinned, hatched = auto-suggested.{" "}
            <span className={styles.soon}>Drag to reschedule — coming next.</span>
          </p>
        </div>
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

      {board.stages.length === 0 ? (
        <div className={styles.empty}>
          No planning blocks yet. Add blocks on the <a href="/calendar">calendar</a> to build a schedule.
        </div>
      ) : (
        <>
          <div className={styles.legend}>
            {board.stages.map((s) => (
              <span key={s.stage} className={styles.legendItem} style={{ ["--stage-color" as string]: s.color }}>
                <span className={styles.legendDot} />
                {s.stage}
              </span>
            ))}
          </div>

          <div className={styles.board}>
            <div className={styles.scroll}>
              <div className={styles.inner} style={{ width: innerWidth, height: fullHeight }}>
                {/* row separators */}
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
                <div className={styles.today} style={{ height: fullHeight }} />
                <div className={styles.axis} style={{ height: AXIS_H }}>
                  {ticks.map((t) => (
                    <span key={`t${t.offset}`} className={styles.tick} style={{ left: t.offset * PX_PER_DAY + 4 }}>
                      {t.offset === 0 ? "Today" : t.label}
                    </span>
                  ))}
                </div>
                {/* on-board deal labels: left edge at the scheduled date, colored by stage */}
                {allRows.map((r, i) => {
                  const placed = !!r.placement;
                  const offset = placed ? daysBetween(today, r.placement!.date) : 0;
                  if (placed && (offset < 0 || offset >= totalDays)) return null;
                  const left = placed ? offset * PX_PER_DAY : 0;
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
                      className={styles.item}
                      style={{ ["--stage-color" as string]: r.color, left, top: AXIS_H + i * ROW_H + 3, height: ROW_H - 6 }}
                      title={
                        placed
                          ? `${r.name} · ${r.stage} · ${r.hours}h · ${fmtTick(r.placement!.date)}${r.placement!.manual ? " (pinned)" : " (auto)"}`
                          : `${r.name} · ${r.stage} · ${issueLabel}`
                      }
                    >
                      <span className={chipCls} />
                      <span className={`${styles.itemName} ${r.issue ? styles.nameIssue : r.placement?.manual ? "" : styles.nameAuto}`}>
                        {r.name}
                      </span>
                      <span className={r.issue ? styles.itemIssueTag : styles.itemMeta}>
                        {r.issue ? issueLabel : `${r.hours}h`}
                      </span>
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
