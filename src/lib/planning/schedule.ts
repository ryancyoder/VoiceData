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

// A manual placement pins a deal to a specific block window. Shared by the
// Planner and the scheduler so every view honors the same manual arrangement.
export interface Placement {
  dealId: number;
  blockId: string | null;
  date: string;
  position: number;
}

export interface ScheduledDeal {
  deal: ForecastDeal;
  hours: number;
  date: string;
  blockId: string;
  offsetHours: number; // hours already filled in the window before this deal
  manual: boolean;
}

export interface ScheduleStage {
  stage: Stage;
  color: string;
  windows: BlockWindow[];
  scheduled: ScheduledDeal[];
  needsEstimate: ForecastDeal[];
  oversized: ForecastDeal[];
  unscheduled: ForecastDeal[];
  used: Record<string, number>; // "<blockId>|<date>" -> hours used
  capacityHours: number;
}

export interface ScheduleResult {
  stages: ScheduleStage[];
  horizonStart: string;
  horizonEnd: string;
}

const winKey = (blockId: string, date: string) => `${blockId}|${date}`;

// THE single scheduling engine. Both the Forecast and the Planner build on this
// so they always agree: manual placements occupy their window first, then the
// remaining deals auto-fill the leftover capacity FIFO (oldest first), whole
// deals only. With no placements this is the pure auto-forecast.
export function computeSchedule(
  blocks: PlanningBlock[],
  deals: ForecastDeal[],
  stageDefaults: Record<string, number>,
  placements: Map<number, Placement>,
  opts: { todayKey: string; horizonWeeks: number }
): ScheduleResult {
  const horizonStart = opts.todayKey;
  const horizonEnd = addDaysKey(opts.todayKey, opts.horizonWeeks * 7);
  const allWindows = expandBlocks(blocks, horizonStart, horizonEnd);

  const stageOrder = new Map(STAGES.map((s, i) => [s, i] as [Stage, number]));
  const stagesWithBlocks = [...new Set(blocks.map((b) => b.stage))].sort(
    (a, b) => (stageOrder.get(a) ?? 0) - (stageOrder.get(b) ?? 0)
  );

  const stages: ScheduleStage[] = stagesWithBlocks.map((stage) => {
    const windows = allWindows.filter((w) => w.stage === stage);
    const validWindow = new Set(windows.map((w) => winKey(w.blockId, w.date)));
    const remaining = new Map(windows.map((w) => [winKey(w.blockId, w.date), w.capacityHours]));
    const used = new Map(windows.map((w) => [winKey(w.blockId, w.date), 0]));
    const maxWindowCap = windows.reduce((m, w) => Math.max(m, w.capacityHours), 0);
    const capacityHours = windows.reduce((sum, w) => sum + w.capacityHours, 0);

    const stageDeals = deals.filter((d) => d.stage === stage);
    const effortOf = (d: ForecastDeal) => d.estimatedHours ?? stageDefaults[stage] ?? 0;

    const scheduled: ScheduledDeal[] = [];
    const needsEstimate: ForecastDeal[] = [];
    const oversized: ForecastDeal[] = [];
    const unscheduled: ForecastDeal[] = [];

    // 1. Manual placements first — pinned to their window (may overbook).
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
      scheduled.push({ deal: d, hours: effort, date: p.date, blockId: p.blockId!, offsetHours: used.get(k) ?? 0, manual: true });
      used.set(k, (used.get(k) ?? 0) + effort);
      remaining.set(k, (remaining.get(k) ?? 0) - effort);
    }

    // 2. Everything else auto-fills the remaining capacity, FIFO.
    const autoDeals = stageDeals
      .filter((d) => !manualIds.has(d.id))
      .sort((a, b) => (a.orderDate === b.orderDate ? a.id - b.id : a.orderDate.localeCompare(b.orderDate)));

    for (const d of autoDeals) {
      const effort = effortOf(d);
      if (effort <= 0) {
        needsEstimate.push(d);
        continue;
      }
      if (maxWindowCap > 0 && effort > maxWindowCap + EPS) {
        oversized.push(d);
        continue;
      }
      let placed = false;
      for (const w of windows) {
        const k = winKey(w.blockId, w.date);
        if ((remaining.get(k) ?? 0) + EPS >= effort) {
          scheduled.push({ deal: d, hours: effort, date: w.date, blockId: w.blockId, offsetHours: used.get(k) ?? 0, manual: false });
          used.set(k, (used.get(k) ?? 0) + effort);
          remaining.set(k, (remaining.get(k) ?? 0) - effort);
          placed = true;
          break;
        }
      }
      if (!placed) unscheduled.push(d);
    }

    return {
      stage,
      color: blockColor({ stage, color: null }),
      windows,
      scheduled,
      needsEstimate,
      oversized,
      unscheduled,
      used: Object.fromEntries(used),
      capacityHours,
    };
  });

  return { stages, horizonStart, horizonEnd };
}

// Forecast view: derive per-stage summary metrics from the shared schedule.
export function computeForecast(
  blocks: PlanningBlock[],
  deals: ForecastDeal[],
  stageDefaults: Record<string, number>,
  placements: Map<number, Placement>,
  opts: { todayKey: string; horizonWeeks: number }
): ForecastResult {
  const sched = computeSchedule(blocks, deals, stageDefaults, placements, opts);
  const effortOf = (stage: string, d: ForecastDeal) => d.estimatedHours ?? stageDefaults[stage] ?? 0;

  const stages: StageForecast[] = sched.stages.map((s) => {
    const winIndex = new Map(s.windows.map((w, i) => [winKey(w.blockId, w.date), i]));
    const assignments: Assignment[] = s.scheduled.map((sd) => ({
      dealId: sd.deal.id,
      dealName: sd.deal.name,
      company: sd.deal.company,
      stage: s.stage,
      hours: sd.hours,
      windowIndex: winIndex.get(winKey(sd.blockId, sd.date)) ?? 0,
      blockId: sd.blockId,
      date: sd.date,
      offsetHours: sd.offsetHours,
    }));
    const scheduledThrough = assignments.reduce<string | null>(
      (latest, a) => (latest === null || a.date > latest ? a.date : latest),
      null
    );
    const backlogHours =
      s.scheduled.reduce((sum, sd) => sum + sd.hours, 0) +
      [...s.oversized, ...s.unscheduled].reduce((sum, d) => sum + effortOf(s.stage, d), 0);

    return {
      stage: s.stage,
      color: s.color,
      windows: s.windows,
      assignments,
      dealCount: s.scheduled.length + s.needsEstimate.length + s.oversized.length + s.unscheduled.length,
      backlogHours,
      capacityHours: s.capacityHours,
      scheduledThrough,
      weeksOut: scheduledThrough ? weeksBetween(opts.todayKey, scheduledThrough) : null,
      unscheduled: s.unscheduled,
      oversized: s.oversized,
      needsEstimate: s.needsEstimate,
    };
  });

  return { stages, horizonStart: sched.horizonStart, horizonEnd: sched.horizonEnd };
}
