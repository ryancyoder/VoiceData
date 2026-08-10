"use client";

import { addDaysKey, type ForecastResult } from "@/lib/planning/schedule";
import styles from "./forecast.module.css";

// Continuous real-time-scale overview: a horizontal date axis starting today,
// one swim lane per stage. Every block window is drawn as a slot on its real
// date (height = capacity, shared scale across lanes); the scheduled portion is
// filled in. Days with no block show as gaps, so you can see the whole
// allocated schedule and the empty space between blocks.

const PX_PER_DAY = 30;
const LANE_H = 46;
const AXIS_H = 26;
const LABEL_W = 128;

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((parseKey(toKey).getTime() - parseKey(fromKey).getTime()) / 86400000);
}
function fmtTick(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ForecastGantt({ forecast, todayKey }: { forecast: ForecastResult; todayKey: string }) {
  const lanes = forecast.stages;
  if (lanes.length === 0) return null;

  // Per stage: block-window capacity per date, and scheduled (used) hours per date.
  const laneData = lanes.map((stage) => {
    const cap = new Map<string, number>();
    for (const w of stage.windows) cap.set(w.date, (cap.get(w.date) ?? 0) + w.capacityHours);
    const used = new Map<string, { hours: number; names: string[] }>();
    for (const a of stage.assignments) {
      const g = used.get(a.date) ?? { hours: 0, names: [] };
      g.hours += a.hours;
      g.names.push(`${a.dealName} (${a.hours}h)`);
      used.set(a.date, g);
    }
    const dates = [...cap.keys()].sort();
    return { stage, cap, used, dates };
  });

  // Shared vertical scale = the biggest single-day block capacity.
  const maxDayHours = Math.max(1, ...laneData.flatMap((l) => [...l.cap.values()]));
  // Range end = the last block window (min 2 weeks out), capped at the horizon.
  const lastKey = laneData.reduce((mx, l) => {
    const d = l.dates.length ? l.dates[l.dates.length - 1] : todayKey;
    return d > mx ? d : mx;
  }, todayKey);
  const minEnd = addDaysKey(todayKey, 13);
  const rangeEnd = lastKey > minEnd ? lastKey : minEnd;
  const endKey = rangeEnd > forecast.horizonEnd ? forecast.horizonEnd : rangeEnd;

  const totalDays = daysBetween(todayKey, endKey) + 1;
  const innerWidth = totalDays * PX_PER_DAY;
  const fullHeight = AXIS_H + lanes.length * LANE_H;
  const barTrack = LANE_H - 14;

  const ticks = Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => {
    const offset = i * 7;
    return { offset, label: fmtTick(addDaysKey(todayKey, offset)) };
  });

  return (
    <div className={styles.gantt}>
      <div className={styles.ganttHead}>
        <span>Timeline</span>
        <span className={styles.ganttHint}>each slot = a block window · filled = scheduled · height ∝ capacity</span>
      </div>
      <div className={styles.ganttBody}>
        {/* Fixed stage-label column */}
        <div className={styles.labels} style={{ width: LABEL_W }}>
          <div style={{ height: AXIS_H }} />
          {lanes.map((stage) => (
            <div
              key={stage.stage}
              className={styles.laneLabel}
              style={{ height: LANE_H, ["--stage-color" as string]: stage.color }}
            >
              <span className={styles.laneDot} />
              <span className={styles.laneName}>{stage.stage}</span>
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div className={styles.scroll}>
          <div className={styles.inner} style={{ width: innerWidth, height: fullHeight }}>
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
            {laneData.map(({ stage, cap, used, dates }) => (
              <div key={stage.stage} className={styles.lane} style={{ height: LANE_H, ["--stage-color" as string]: stage.color }}>
                {dates.map((date) => {
                  const offset = daysBetween(todayKey, date);
                  if (offset < 0 || offset >= totalDays) return null;
                  const capH = cap.get(date) ?? 0;
                  const u = used.get(date);
                  const usedH = u?.hours ?? 0;
                  const slotH = Math.max(6, (capH / maxDayHours) * barTrack);
                  const fillH = (usedH / maxDayHours) * barTrack;
                  return (
                    <div
                      key={date}
                      className={styles.slot}
                      style={{ left: offset * PX_PER_DAY + 2, width: PX_PER_DAY - 4, height: slotH }}
                      title={`${fmtTick(date)} · ${usedH}/${capH}h${u ? "\n" + u.names.join("\n") : " · open"}`}
                    >
                      {fillH > 0 && <div className={styles.slotFill} style={{ height: Math.min(slotH, fillH) }} />}
                      {u && u.names.length > 0 && <span className={styles.slotCount}>{u.names.length}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
