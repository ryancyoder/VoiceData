"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanningBlock } from "@/lib/planning/blocks";
import { computeForecast, type ForecastDeal } from "@/lib/planning/schedule";
import styles from "./forecast.module.css";

const HORIZONS = [4, 8, 12, 26];
const PX_PER_HOUR = 22;

function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

type DealStatus =
  | { kind: "scheduled"; date: string }
  | { kind: "unscheduled" }
  | { kind: "oversized" }
  | { kind: "needsEstimate" };

export default function ForecastClient({
  blocks,
  deals,
  initialDefaults,
}: {
  blocks: PlanningBlock[];
  deals: ForecastDeal[];
  initialDefaults: Record<string, number>;
}) {
  const router = useRouter();
  const defaults = initialDefaults;
  const [horizonWeeks, setHorizonWeeks] = useState(12);
  const [today] = useState(todayKey);

  const forecast = useMemo(
    () => computeForecast(blocks, deals, defaults, { todayKey: today, horizonWeeks }),
    [blocks, deals, defaults, today, horizonWeeks]
  );

  async function commitDealHours(dealId: number, raw: string) {
    const trimmed = raw.trim();
    const hours = trimmed === "" ? null : Number(trimmed);
    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) return;
    await fetch(`/api/planning/deal-estimate/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    });
    router.refresh();
  }

  return (
    <div className={styles.forecast}>
      <div className={styles.header}>
        <div>
          <h1>Forecast</h1>
          <p>How far out your pipeline runs, packing deals into planning blocks by stage.</p>
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

      <p className={styles.defaultsHint}>
        Deals without their own estimate use the per-stage default effort — set those in{" "}
        <a href="/settings">Settings</a>. Override an individual deal in its row below.
      </p>

      {forecast.stages.length === 0 && (
        <div className={styles.empty}>
          No planning blocks yet. Add blocks on the <a href="/calendar">calendar</a> (one per work stage) to build a forecast.
        </div>
      )}

      {forecast.stages.map((stage) => {
        // Per-deal status lookup for the table.
        const status = new Map<number, DealStatus>();
        for (const a of stage.assignments) status.set(a.dealId, { kind: "scheduled", date: a.date });
        for (const d of stage.unscheduled) status.set(d.id, { kind: "unscheduled" });
        for (const d of stage.oversized) status.set(d.id, { kind: "oversized" });
        for (const d of stage.needsEstimate) status.set(d.id, { kind: "needsEstimate" });

        const stageDeals = deals
          .filter((d) => d.stage === stage.stage)
          .sort((a, b) => (a.orderDate === b.orderDate ? a.id - b.id : a.orderDate.localeCompare(b.orderDate)));

        return (
          <section key={stage.stage} className={styles.stage} style={{ ["--stage-color" as string]: stage.color }}>
            <div className={styles.stageHead}>
              <span className={styles.stageDot} />
              <h2>{stage.stage}</h2>
              <span className={styles.metric}>{stage.dealCount} deals</span>
              <span className={styles.metric}>{stage.backlogHours}h backlog</span>
              <span className={styles.metric}>
                {stage.capacityHours}h capacity / {horizonWeeks}w
              </span>
              {stage.scheduledThrough ? (
                <span className={styles.through}>
                  scheduled through <strong>{fmtDate(stage.scheduledThrough)}</strong>
                  {stage.weeksOut != null && ` · ~${stage.weeksOut}w out`}
                </span>
              ) : (
                <span className={styles.metric}>nothing scheduled yet</span>
              )}
              {stage.unscheduled.length > 0 && (
                <span className={styles.warn}>{stage.unscheduled.length} beyond horizon</span>
              )}
              {stage.oversized.length > 0 && (
                <span className={styles.warn}>{stage.oversized.length} too big for a block</span>
              )}
              {stage.needsEstimate.length > 0 && (
                <span className={styles.warn}>{stage.needsEstimate.length} need an estimate</span>
              )}
            </div>

            {/* Timeline: block windows (chronological) with packed deal bars */}
            {stage.windows.length === 0 ? (
              <p className={styles.noWindows}>No blocks for this stage within the horizon.</p>
            ) : (
              <div className={styles.timeline}>
                {stage.windows.map((w, i) => {
                  const winAssignments = stage.assignments.filter((a) => a.windowIndex === i);
                  return (
                    <div key={`${w.blockId}-${w.date}-${i}`} className={styles.window}>
                      <div className={styles.windowHead}>
                        {fmtDate(w.date)}
                        <span className={styles.windowCap}>{w.capacityHours}h</span>
                      </div>
                      <div className={styles.windowBar} style={{ height: w.capacityHours * PX_PER_HOUR }}>
                        {winAssignments.map((a) => (
                          <div
                            key={a.dealId}
                            className={styles.dealBar}
                            style={{ top: a.offsetHours * PX_PER_HOUR, height: a.hours * PX_PER_HOUR }}
                            title={`${a.dealName} · ${a.hours}h`}
                          >
                            <span className={styles.dealBarLabel}>{a.dealName}</span>
                            <span className={styles.dealBarHours}>{a.hours}h</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Deal detail + estimate editing */}
            <table className={styles.dealTable}>
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Since</th>
                  <th>Est. hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stageDeals.map((d) => {
                  const st = status.get(d.id);
                  return (
                    <tr key={d.id}>
                      <td>
                        {d.name}
                        {d.company ? <span className={styles.company}> · {d.company}</span> : null}
                      </td>
                      <td className={styles.since}>{d.orderDate}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          className={styles.hoursInput}
                          defaultValue={d.estimatedHours ?? ""}
                          placeholder={`${defaults[stage.stage] ?? 0} (default)`}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            const original = d.estimatedHours ?? "";
                            if (v !== String(original)) commitDealHours(d.id, v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </td>
                      <td>
                        {st?.kind === "scheduled" && <span className={styles.ok}>{fmtDate(st.date)}</span>}
                        {st?.kind === "unscheduled" && <span className={styles.warn}>beyond horizon</span>}
                        {st?.kind === "oversized" && <span className={styles.warn}>too big for a block</span>}
                        {st?.kind === "needsEstimate" && <span className={styles.muted}>needs an estimate</span>}
                      </td>
                    </tr>
                  );
                })}
                {stageDeals.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.muted}>
                      No open deals in this stage.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
