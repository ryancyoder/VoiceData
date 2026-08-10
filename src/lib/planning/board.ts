import type { Stage } from "@/lib/salesBoard";
import type { PlanningBlock } from "./blocks";
import { computeSchedule, type BlockWindow, type ForecastDeal, type Placement } from "./schedule";

// The Planner board: one row per deal, grouped by stage. It's a thin projection
// of the shared scheduling engine (computeSchedule) — the exact same schedule
// the Forecast uses — so the two views can never drift apart.

export type { Placement } from "./schedule";

export type BoardIssue = "unplaced" | "oversized" | "needsEstimate";

export interface BoardDealRow {
  dealId: number;
  name: string;
  company: string | null;
  hours: number;
  orderDate: string;
  placement: { date: string; blockId: string; manual: boolean } | null;
  issue: BoardIssue | null;
}

export interface BoardStage {
  stage: Stage;
  color: string;
  windows: BlockWindow[];
  rows: BoardDealRow[];
  used: Record<string, number>;
}

export interface BoardResult {
  stages: BoardStage[];
  horizonStart: string;
  horizonEnd: string;
}

export function computeBoard(
  blocks: PlanningBlock[],
  deals: ForecastDeal[],
  stageDefaults: Record<string, number>,
  placements: Map<number, Placement>,
  opts: { todayKey: string; horizonWeeks: number }
): BoardResult {
  const sched = computeSchedule(blocks, deals, stageDefaults, placements, opts);
  const effortOf = (stage: string, d: ForecastDeal) => d.estimatedHours ?? stageDefaults[stage] ?? 0;

  const stages: BoardStage[] = sched.stages.map((s) => {
    const rows: BoardDealRow[] = [];

    for (const sd of s.scheduled) {
      rows.push({
        dealId: sd.deal.id,
        name: sd.deal.name,
        company: sd.deal.company,
        hours: sd.hours,
        orderDate: sd.deal.orderDate,
        placement: { date: sd.date, blockId: sd.blockId, manual: sd.manual },
        issue: sd.hours <= 0 ? "needsEstimate" : null,
      });
    }
    const issueRow = (d: ForecastDeal, issue: BoardIssue): BoardDealRow => ({
      dealId: d.id,
      name: d.name,
      company: d.company,
      hours: effortOf(s.stage, d),
      orderDate: d.orderDate,
      placement: null,
      issue,
    });
    for (const d of s.needsEstimate) rows.push(issueRow(d, "needsEstimate"));
    for (const d of s.oversized) rows.push(issueRow(d, "oversized"));
    for (const d of s.unscheduled) rows.push(issueRow(d, "unplaced"));

    // Placed rows by date; unplaced/issue rows sink to the bottom.
    rows.sort((a, b) => {
      const ad = a.placement?.date ?? "9999-99-99";
      const bd = b.placement?.date ?? "9999-99-99";
      return ad === bd ? a.orderDate.localeCompare(b.orderDate) : ad.localeCompare(bd);
    });

    return { stage: s.stage, color: s.color, windows: s.windows, rows, used: s.used };
  });

  return { stages, horizonStart: sched.horizonStart, horizonEnd: sched.horizonEnd };
}
