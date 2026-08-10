import { STAGES, type Stage } from "@/lib/salesBoard";
import { blockColor, type PlanningBlock } from "./blocks";
import { addDaysKey, expandBlocks, type BlockWindow, type ForecastDeal } from "./schedule";

// The Planner board: one row per deal, grouped by stage, placed into block
// windows. Manual placements (planning_placements rows) are honored first and
// occupy their window; everything else is auto-seeded by the same FIFO packer
// the Forecast uses, filling the remaining capacity. So an untouched board
// mirrors the Forecast, and each move you make sticks.

export interface Placement {
  dealId: number;
  blockId: string | null;
  date: string; // 'YYYY-MM-DD'
  position: number;
}

export type BoardIssue = "unplaced" | "oversized" | "needsEstimate";

export interface BoardDealRow {
  dealId: number;
  name: string;
  company: string | null;
  hours: number;
  orderDate: string;
  // Where the deal sits, or null when it couldn't be placed.
  placement: { date: string; blockId: string; manual: boolean } | null;
  issue: BoardIssue | null;
}

export interface BoardStage {
  stage: Stage;
  color: string;
  windows: BlockWindow[];
  rows: BoardDealRow[];
  // Used hours per window ("<blockId>|<date>") — for over-capacity flags.
  used: Record<string, number>;
}

export interface BoardResult {
  stages: BoardStage[];
  horizonStart: string;
  horizonEnd: string;
}

const EPS = 1e-9;
const winKey = (blockId: string, date: string) => `${blockId}|${date}`;

export function computeBoard(
  blocks: PlanningBlock[],
  deals: ForecastDeal[],
  stageDefaults: Record<string, number>,
  placements: Map<number, Placement>,
  opts: { todayKey: string; horizonWeeks: number }
): BoardResult {
  const horizonStart = opts.todayKey;
  const horizonEnd = addDaysKey(opts.todayKey, opts.horizonWeeks * 7);
  const allWindows = expandBlocks(blocks, horizonStart, horizonEnd);

  const stageOrder = new Map(STAGES.map((s, i) => [s, i] as [Stage, number]));
  const stagesWithBlocks = [...new Set(blocks.map((b) => b.stage))].sort(
    (a, b) => (stageOrder.get(a) ?? 0) - (stageOrder.get(b) ?? 0)
  );

  const stages: BoardStage[] = stagesWithBlocks.map((stage) => {
    const windows = allWindows.filter((w) => w.stage === stage);
    const validWindow = new Set(windows.map((w) => winKey(w.blockId, w.date)));
    const remaining = new Map(windows.map((w) => [winKey(w.blockId, w.date), w.capacityHours]));
    const used = new Map(windows.map((w) => [winKey(w.blockId, w.date), 0]));
    const maxWindowCap = windows.reduce((m, w) => Math.max(m, w.capacityHours), 0);

    const stageDeals = deals.filter((d) => d.stage === stage);
    const effortOf = (d: ForecastDeal) => d.estimatedHours ?? stageDefaults[stage] ?? 0;

    const rows: BoardDealRow[] = [];

    // 1. Manual placements first — a deal with a placement that still points at a
    //    real window of this stage is pinned there (may overbook: allowed, flagged).
    const manualDeals = stageDeals
      .filter((d) => {
        const p = placements.get(d.id);
        return p && p.blockId && validWindow.has(winKey(p.blockId, p.date));
      })
      .sort((a, b) => {
        const pa = placements.get(a.id)!;
        const pb = placements.get(b.id)!;
        return pa.date === pb.date ? pa.position - pb.position : pa.date.localeCompare(pb.date);
      });
    const manualIds = new Set(manualDeals.map((d) => d.id));

    for (const d of manualDeals) {
      const p = placements.get(d.id)!;
      const effort = effortOf(d);
      const k = winKey(p.blockId!, p.date);
      used.set(k, (used.get(k) ?? 0) + effort);
      remaining.set(k, (remaining.get(k) ?? 0) - effort);
      rows.push({
        dealId: d.id,
        name: d.name,
        company: d.company,
        hours: effort,
        orderDate: d.orderDate,
        placement: { date: p.date, blockId: p.blockId!, manual: true },
        issue: effort <= 0 ? "needsEstimate" : null,
      });
    }

    // 2. Everything else auto-fills the remaining capacity, FIFO (oldest first).
    const autoDeals = stageDeals
      .filter((d) => !manualIds.has(d.id))
      .sort((a, b) => (a.orderDate === b.orderDate ? a.id - b.id : a.orderDate.localeCompare(b.orderDate)));

    for (const d of autoDeals) {
      const effort = effortOf(d);
      const base = { dealId: d.id, name: d.name, company: d.company, hours: effort, orderDate: d.orderDate };
      if (effort <= 0) {
        rows.push({ ...base, placement: null, issue: "needsEstimate" });
        continue;
      }
      if (maxWindowCap > 0 && effort > maxWindowCap + EPS) {
        rows.push({ ...base, placement: null, issue: "oversized" });
        continue;
      }
      let placed = false;
      for (const w of windows) {
        const k = winKey(w.blockId, w.date);
        if ((remaining.get(k) ?? 0) + EPS >= effort) {
          used.set(k, (used.get(k) ?? 0) + effort);
          remaining.set(k, (remaining.get(k) ?? 0) - effort);
          rows.push({ ...base, placement: { date: w.date, blockId: w.blockId, manual: false }, issue: null });
          placed = true;
          break;
        }
      }
      if (!placed) rows.push({ ...base, placement: null, issue: "unplaced" });
    }

    // Display order: placed rows by date (unplaced/issues sink to the bottom).
    rows.sort((a, b) => {
      const ad = a.placement?.date ?? "9999-99-99";
      const bd = b.placement?.date ?? "9999-99-99";
      return ad === bd ? a.orderDate.localeCompare(b.orderDate) : ad.localeCompare(bd);
    });

    return {
      stage,
      color: blockColor({ stage, color: null }),
      windows,
      rows,
      used: Object.fromEntries(used),
    };
  });

  return { stages, horizonStart, horizonEnd };
}
