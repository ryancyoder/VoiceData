"use client";

import { addDaysKey, type ForecastResult } from "@/lib/planning/schedule";
import styles from "./forecast.module.css";

// Continuous real-time-scale overview: a horizontal date axis starting today,
// with one swim lane per stage. Each day a stage has scheduled deals gets a
// bar (height = hours that day, shared scale across lanes) so you can see, at a
// glance, where the pipeline lands over time and how far out each stage runs.

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

  // Group each stage's assignments by date.
  const laneData = lanes.map((stage) => {
    const byDate = new Map<string, { hours: number; names: string[] }>();
    for (const a of stage.assignments) {
      const g = byDate.get(a.date) ?? { hours: 0, names: [] };
      g.hours += a.hours;
      g.names.push(`${a.dealName} (${a.hours}h)`);
      byDate.set(a.date, g);
    }
    return { stage, groups: [...byDate.entries()] };
  });

  // Range end (last scheduled day, min 2 weeks, capped at horizon) and the
  // busiest day, derived without mutating during render.
  const allGroups = laneData.flatMap((l) => l.groups);
  const lastKey = allGroups.reduce((mx, [date]) => (date > mx ? date : mx), todayKey);
  const maxDayHours = allGroups.reduce((mx, [, g]) => Math.max(mx, g.hours), 0);

  const minEnd = addDaysKey(todayKey, 13);
  const rangeEnd = lastKey > minEnd ? lastKey : minEnd;
  const endKey = rangeEnd > forecast.horizonEnd ? forecast.horizonEnd : rangeEnd;
  const totalDays = daysBetween(todayKey, endKey) + 1;
  const innerWidth = totalDays * PX_PER_DAY;
  const fullHeight = AXIS_H + lanes.length * LANE_H;

  // Weekly tick marks.
  const ticks = Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => {
    const offset = i * 7;
    return { offset, label: fmtTick(addDaysKey(todayKey, offset)) };
  });

  const barTrack = LANE_H - 14;

  return (
    <div className={styles.gantt}>
      <div className={styles.ganttHead}>
        <span>Timeline</span>
        <span className={styles.ganttHint}>each bar = a day&apos;s scheduled work · height ∝ hours</span>
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
            {/* week gridlines */}
            {ticks.map((t) => (
              <div key={`g${t.offset}`} className={styles.grid} style={{ left: t.offset * PX_PER_DAY, height: fullHeight }} />
            ))}
            {/* today marker */}
            <div className={styles.today} style={{ height: fullHeight }} />
            {/* axis labels */}
            <div className={styles.axis} style={{ height: AXIS_H }}>
              {ticks.map((t) => (
                <span key={`t${t.offset}`} className={styles.tick} style={{ left: t.offset * PX_PER_DAY + 4 }}>
                  {t.offset === 0 ? "Today" : t.label}
                </span>
              ))}
            </div>
            {/* lanes */}
            {laneData.map(({ stage, groups }) => (
              <div key={stage.stage} className={styles.lane} style={{ height: LANE_H, ["--stage-color" as string]: stage.color }}>
                {groups.map(([date, g]) => {
                  const offset = daysBetween(todayKey, date);
                  if (offset < 0 || offset >= totalDays) return null;
                  const h = maxDayHours > 0 ? Math.max(6, (g.hours / maxDayHours) * barTrack) : 6;
                  return (
                    <div
                      key={date}
                      className={styles.dayBar}
                      style={{ left: offset * PX_PER_DAY + 2, width: PX_PER_DAY - 4, height: h }}
                      title={`${fmtTick(date)} · ${g.hours}h\n${g.names.join("\n")}`}
                    >
                      <span className={styles.dayBarCount}>{g.names.length}</span>
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
