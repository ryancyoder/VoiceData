"use client";

import { useMemo, useState } from "react";
import type { PlanningBlock } from "@/lib/planning/blocks";
import type { ForecastDeal } from "@/lib/planning/schedule";
import { computeBoard, type Placement } from "@/lib/planning/board";
import styles from "./planner.module.css";

const PX_PER_DAY = 26;
const ROW_H = 26;
const AXIS_H = 24;
const LABEL_W = 210;
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

      {board.stages.length === 0 && (
        <div className={styles.empty}>
          No planning blocks yet. Add blocks on the <a href="/calendar">calendar</a> to build a schedule.
        </div>
      )}

      {board.stages.map((stage) => {
        const placedCount = stage.rows.filter((r) => r.placement).length;
        const issues = stage.rows.filter((r) => r.issue).length;
        const fullHeight = AXIS_H + Math.max(1, stage.rows.length) * ROW_H;

        return (
          <section key={stage.stage} className={styles.stage} style={{ ["--stage-color" as string]: stage.color }}>
            <div className={styles.stageHead}>
              <span className={styles.dot} />
              <h2>{stage.stage}</h2>
              <span className={styles.metric}>{stage.rows.length} deals</span>
              <span className={styles.metric}>{placedCount} scheduled</span>
              {issues > 0 && <span className={styles.warn}>{issues} unplaced</span>}
            </div>

            <div className={styles.board}>
              {/* Deal-name column */}
              <div className={styles.labels} style={{ width: LABEL_W }}>
                <div style={{ height: AXIS_H }} />
                {stage.rows.map((r) => (
                  <div key={r.dealId} className={styles.rowLabel} style={{ height: ROW_H }}>
                    <span className={styles.rowName}>{r.name}</span>
                    {r.issue ? (
                      <span className={styles.rowTag}>
                        {r.issue === "needsEstimate" ? "no estimate" : r.issue === "oversized" ? "too big" : "no room"}
                      </span>
                    ) : (
                      <span className={styles.rowHours}>{r.hours}h</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Timeline */}
              <div className={styles.scroll}>
                <div className={styles.inner} style={{ width: innerWidth, height: fullHeight }}>
                  {/* block-window guide bands (full lane height) */}
                  {stage.windows.map((w, i) => {
                    const offset = daysBetween(today, w.date);
                    if (offset < 0 || offset >= totalDays) return null;
                    const over = (stage.used[`${w.blockId}|${w.date}`] ?? 0) > w.capacityHours + 1e-9;
                    return (
                      <div
                        key={`${w.blockId}-${w.date}-${i}`}
                        className={`${styles.windowBand} ${over ? styles.windowOver : ""}`}
                        style={{ left: offset * PX_PER_DAY, width: PX_PER_DAY, top: AXIS_H, height: fullHeight - AXIS_H }}
                        title={`${fmtTick(w.date)} · ${stage.used[`${w.blockId}|${w.date}`] ?? 0}/${w.capacityHours}h`}
                      />
                    );
                  })}
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
                  {/* deal bars */}
                  {stage.rows.map((r, i) => {
                    if (!r.placement) return null;
                    const offset = daysBetween(today, r.placement.date);
                    if (offset < 0 || offset >= totalDays) return null;
                    return (
                      <div
                        key={r.dealId}
                        className={`${styles.bar} ${r.placement.manual ? styles.barPinned : styles.barAuto}`}
                        style={{ left: offset * PX_PER_DAY + 3, width: PX_PER_DAY - 6, top: AXIS_H + i * ROW_H + 4, height: ROW_H - 8 }}
                        title={`${r.name} · ${r.hours}h · ${fmtTick(r.placement.date)}${r.placement.manual ? " (pinned)" : " (auto)"}`}
                      >
                        <span className={styles.barHours}>{r.hours}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
