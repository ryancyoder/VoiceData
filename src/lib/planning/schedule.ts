import { STAGES, type Stage } from "@/lib/salesBoard";
import { blockColor, blockHours, blockOccursOn, type PlanningBlock } from "./blocks";

// The forecast/scheduler. Pure and deterministic: given planning blocks, the
// deals in each block's stage, and per-stage default effort, it packs deals
// into the block windows across a rolling horizon and reports how far out each
// stage runs. No persisted assignments — this is recomputed live.
//
// Rules (per the feature's decisions):
//  - effort per deal = its estimatedHours override, else the stage default.
//  - order = FIFO, oldest first (orderDate).
//  - deals stay whole: a deal that doesn't fit the current window bumps to the
//    next window with enough remaining capacity.
//  - capacity = block duration (real events are not subtracted).

export interface ForecastDeal {
  id: number;
  name: string;
  company: string | null;
  stage: Stage;
  estimatedHours: number | null;
  orderDate: string; // 'YYYY-MM-DD' used for FIFO (proposal_date ?? created_at)
}

export interface BlockWindow {
  blockId: string;
  stage: Stage;
  date: string; // 'YYYY-MM-DD'
  startTime: string;
  endTime: string;
  capacityHours: number;
  title: string | null;
  color: string;
}

export interface Assignment {
  dealId: number;
  dealName: string;
  company: string | null;
  stage: Stage;
  hours: number;
  windowIndex: number; // index into the stage's windows array
  blockId: string;
  date: string;
  offsetHours: number; // hours already filled in the window before this deal
}

export interface StageForecast {
  stage: Stage;
  color: string;
  windows: BlockWindow[];
  assignments: Assignment[];
  dealCount: number;
  backlogHours: number; // total effort of deals that have an estimate
  capacityHours: number; // total window capacity within the horizon
  scheduledThrough: string | null; // latest date a deal lands on
  weeksOut: number | null; // whole weeks from today to scheduledThrough
  unscheduled: ForecastDeal[]; // have effort but no room within the horizon
  oversized: ForecastDeal[]; // effort exceeds any single window's capacity
  needsEstimate: ForecastDeal[]; // no estimate (effort <= 0)
}

export interface ForecastResult {
  stages: StageForecast[];
  horizonStart: string;
  horizonEnd: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysKey(key: string, n: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// Whole weeks (rounded up) between two date keys; 0 if same/earlier.
export function weeksBetween(fromKey: string, toKey: string): number {
  const ms = parseKey(toKey).getTime() - parseKey(fromKey).getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (7 * 24 * 60 * 60 * 1000));
}

// Expand blocks into concrete dated windows within [startKey, endKey],
// sorted chronologically by date then start time.
export function expandBlocks(blocks: PlanningBlock[], startKey: string, endKey: string): BlockWindow[] {
  const windows: BlockWindow[] = [];
  const end = parseKey(endKey);
  for (let d = parseKey(startKey); d <= end; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    const weekday = d.getDay();
    for (const b of blocks) {
      if (!blockOccursOn(b, key, weekday)) continue;
      windows.push({
        blockId: b.id,
        stage: b.stage,
        date: key,
        startTime: b.startTime,
        endTime: b.endTime,
        capacityHours: blockHours(b.startTime, b.endTime),
        title: b.title,
        color: blockColor(b),
      });
    }
  }
  windows.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
  return windows;
}

const EPS = 1e-9;

export function computeForecast(
  blocks: PlanningBlock[],
  deals: ForecastDeal[],
  stageDefaults: Record<string, number>,
  opts: { todayKey: string; horizonWeeks: number }
): ForecastResult {
  const horizonStart = opts.todayKey;
  const horizonEnd = addDaysKey(opts.todayKey, opts.horizonWeeks * 7);
  const allWindows = expandBlocks(blocks, horizonStart, horizonEnd);

  // Only forecast stages you've actually blocked time for.
  const stageOrder = new Map(STAGES.map((s, i) => [s, i] as [Stage, number]));
  const stagesWithBlocks = [...new Set(blocks.map((b) => b.stage))].sort(
    (a, b) => (stageOrder.get(a) ?? 0) - (stageOrder.get(b) ?? 0)
  );

  const stages: StageForecast[] = stagesWithBlocks.map((stage) => {
    const windows = allWindows.filter((w) => w.stage === stage);
    const remaining = windows.map((w) => w.capacityHours);
    const used = windows.map(() => 0);
    const maxWindowCap = windows.reduce((m, w) => Math.max(m, w.capacityHours), 0);
    const capacityHours = windows.reduce((sum, w) => sum + w.capacityHours, 0);

    const stageDeals = deals
      .filter((d) => d.stage === stage)
      .sort((a, b) => (a.orderDate === b.orderDate ? a.id - b.id : a.orderDate.localeCompare(b.orderDate)));

    const assignments: Assignment[] = [];
    const unscheduled: ForecastDeal[] = [];
    const oversized: ForecastDeal[] = [];
    const needsEstimate: ForecastDeal[] = [];
    let backlogHours = 0;

    for (const deal of stageDeals) {
      const effort = deal.estimatedHours ?? stageDefaults[stage] ?? 0;
      if (effort <= 0) {
        needsEstimate.push(deal);
        continue;
      }
      backlogHours += effort;
      if (maxWindowCap > 0 && effort > maxWindowCap + EPS) {
        oversized.push(deal);
        continue;
      }
      let placed = false;
      for (let i = 0; i < windows.length; i++) {
        if (remaining[i] + EPS >= effort) {
          assignments.push({
            dealId: deal.id,
            dealName: deal.name,
            company: deal.company,
            stage,
            hours: effort,
            windowIndex: i,
            blockId: windows[i].blockId,
            date: windows[i].date,
            offsetHours: used[i],
          });
          remaining[i] -= effort;
          used[i] += effort;
          placed = true;
          break;
        }
      }
      if (!placed) unscheduled.push(deal);
    }

    const scheduledThrough = assignments.reduce<string | null>(
      (latest, a) => (latest === null || a.date > latest ? a.date : latest),
      null
    );

    return {
      stage,
      color: blockColor({ stage, color: null }),
      windows,
      assignments,
      dealCount: stageDeals.length,
      backlogHours,
      capacityHours,
      scheduledThrough,
      weeksOut: scheduledThrough ? weeksBetween(opts.todayKey, scheduledThrough) : null,
      unscheduled,
      oversized,
      needsEstimate,
    };
  });

  return { stages, horizonStart, horizonEnd };
}
