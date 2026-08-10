"use client";

import { useState } from "react";
import { addDaysKey, type ForecastResult } from "@/lib/planning/schedule";
import styles from "./forecast.module.css";

// Continuous real-time-scale overview: a horizontal date axis starting today,
// one swim lane per stage. Every block window is drawn as a slot on its real
// date (height = capacity, shared scale); the scheduled portion is filled and
// the open capacity is hatched. Days with no block show as gaps.
//
// "Hide weekends" collapses Sat/Sun to zero width (a dotted line between weeks)
// so the workweek reads denser. Positioning is driven by a per-day width
// prefix-sum so both modes share one code path.

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
  const [hideWeekends, setHideWeekends] = useState(false);

  const lanes = forecast.stages;
  if (lanes.length === 0) return null;

  // Per stage: block-window capacity per date, and scheduled hours per date.
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

  const maxDayHours = Math.max(1, ...laneData.flatMap((l) => [...l.cap.values()]));
  const lastKey = laneData.reduce((mx, l) => {
    const d = l.dates.length ? l.dates[l.dates.length - 1] : todayKey;
    return d > mx ? d : mx;
  }, todayKey);
  const minEnd = addDaysKey(todayKey, 13);
  const rangeEnd = lastKey > minEnd ? lastKey : minEnd;
  const endKey = rangeEnd > forecast.horizonEnd ? forecast.horizonEnd : rangeEnd;
  const totalDays = daysBetween(todayKey, endKey) + 1;

  const todayWd = parseKey(todayKey).getDay();
  const isWeekend = (offset: number) => {
    const wd = (todayWd + offset) % 7;
    return wd === 0 || wd === 6;
  };

  // Per-day width and its left-edge prefix sum (xAt[offset]); weekends collapse
  // to 0 width when hidden.
  const widths = Array.from({ length: totalDays }, (_, i) => (hideWeekends && isWeekend(i) ? 0 : PX_PER_DAY));
  const xAt = widths.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [0]);
  const innerWidth = xAt[totalDays];
  const fullHeight = AXIS_H + lanes.length * LANE_H;
  const barTrack = LANE_H - 14;

  const ticks = Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => {
    const offset = i * 7;
    return { offset, label: fmtTick(addDaysKey(todayKey, offset)) };
  });

  const allOffsets = Array.from({ length: totalDays }, (_, i) => i);
  const weekendOffsets = allOffsets.filter(isWeekend);
  // One dotted separator per weekend (anchored on Saturday's collapsed edge).
  const separatorOffsets = weekendOffsets.filter((i) => (todayWd + i) % 7 === 6);

  return (
    <div className={styles.gantt}>
      <div className={styles.ganttHead}>
        <span>Timeline</span>
        <div className={styles.ganttHeadRight}>
          <label className={styles.weekendToggle}>
            <input type="checkbox" checked={hideWeekends} onChange={(e) => setHideWeekends(e.target.checked)} />
            Hide weekends
          </label>
          <span className={styles.ganttHint}>slot = block · filled = scheduled · hatched = open</span>
        </div>
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
            {hideWeekends
              ? separatorOffsets.map((off) => (
                  <div key={`s${off}`} className={styles.weekSep} style={{ left: xAt[off], height: fullHeight }} />
                ))
              : weekendOffsets.map((off) => (
                  <div key={`w${off}`} className={styles.weekend} style={{ left: xAt[off], width: widths[off], height: fullHeight }} />
                ))}
            {ticks.map((t) => (
              <div key={`g${t.offset}`} className={styles.grid} style={{ left: xAt[t.offset], height: fullHeight }} />
            ))}
            <div className={styles.today} style={{ height: fullHeight }} />
            <div className={styles.axis} style={{ height: AXIS_H }}>
              {ticks.map((t) => (
                <span key={`t${t.offset}`} className={styles.tick} style={{ left: xAt[t.offset] + 4 }}>
                  {t.offset === 0 ? "Today" : t.label}
                </span>
              ))}
            </div>
            {laneData.map(({ stage, cap, used, dates }) => (
              <div key={stage.stage} className={styles.lane} style={{ height: LANE_H, ["--stage-color" as string]: stage.color }}>
                {dates.map((date) => {
                  const offset = daysBetween(todayKey, date);
                  if (offset < 0 || offset >= totalDays) return null;
                  const w = widths[offset];
                  if (w === 0) return null; // collapsed weekend
                  const capH = cap.get(date) ?? 0;
                  const u = used.get(date);
                  const usedH = u?.hours ?? 0;
                  const slotH = Math.max(6, (capH / maxDayHours) * barTrack);
                  const fillH = (usedH / maxDayHours) * barTrack;
                  return (
                    <div
                      key={date}
                      className={styles.slot}
                      style={{ left: xAt[offset] + 2, width: w - 4, height: slotH }}
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
