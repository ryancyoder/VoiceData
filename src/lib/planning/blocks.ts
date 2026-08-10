import { STAGES, type Stage } from "@/lib/salesBoard";

// A planning block: a typed, faded "intent" window on the calendar, tied to a
// deal stage. Capacity = its duration (startTime..endTime). Either a one-off on
// a specific date, or recurring on given weekdays across an optional window.
// Blocks are the source of truth for the forecast/scheduler (built in Phase 2).

export type BlockKind = "one_off" | "recurring";

export interface PlanningBlock {
  id: string;
  stage: Stage;
  title: string | null;
  color: string | null;
  kind: BlockKind;
  blockDate: string | null; // one-off: 'YYYY-MM-DD'
  weekdays: number[] | null; // recurring: 0=Sun..6=Sat
  startsOn: string | null; // recurring window start (null = open/today)
  endsOn: string | null; // recurring window end (null = open-ended)
  excludedDates: string[]; // recurring: dates the series skips (detached instances)
  startTime: string; // 'HH:MM'
  endTime: string; // 'HH:MM'
  createdAt: string;
  updatedAt: string;
}

export interface PlanningBlockRow {
  id: string;
  stage: string;
  title: string | null;
  color: string | null;
  kind: string;
  block_date: string | null;
  weekdays: number[] | null;
  starts_on: string | null;
  ends_on: string | null;
  excluded_dates: string[] | null;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

export const PLANNING_BLOCK_COLUMNS =
  "id, stage, title, color, kind, block_date, weekdays, starts_on, ends_on, excluded_dates, start_time, end_time, created_at, updated_at";

const STAGE_SET = new Set<string>(STAGES);

// Per-stage color tokens (global CSS vars, shared with the Sales Board / next
// actions views). A block defaults to its stage's color; block.color overrides.
export const STAGE_COLORS: Record<Stage, string> = {
  Lead: "var(--c-lead)",
  Propose: "var(--c-propose)",
  Sent: "var(--c-send)",
  Sold: "var(--c-sold)",
  "Project Management": "var(--c-pm)",
  "Job Costing": "var(--c-jobcosting)",
  Invoiced: "var(--c-invoiced)",
  "Paid in Full": "var(--c-paid)",
};

export function blockColor(block: Pick<PlanningBlock, "stage" | "color">): string {
  return block.color ?? STAGE_COLORS[block.stage] ?? "var(--c-lead)";
}

// Whether a block occurs on a given local calendar day. dateKey is 'YYYY-MM-DD'
// and weekday is 0=Sun..6=Sat (both derived from the same local Date). Date-key
// string comparison is safe because the format sorts lexicographically.
export function blockOccursOn(block: PlanningBlock, dateKey: string, weekday: number): boolean {
  if (block.kind === "one_off") return block.blockDate === dateKey;
  if (!block.weekdays?.includes(weekday)) return false;
  if (block.startsOn && dateKey < block.startsOn) return false;
  if (block.endsOn && dateKey > block.endsOn) return false;
  if (block.excludedDates?.includes(dateKey)) return false; // detached instance
  return true;
}

// Duration of a block in hours (its capacity), from 'HH:MM' bounds.
export function blockHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

export function rowToBlock(r: PlanningBlockRow): PlanningBlock {
  return {
    id: r.id,
    stage: r.stage as Stage,
    title: r.title,
    color: r.color,
    kind: r.kind === "recurring" ? "recurring" : "one_off",
    blockDate: r.block_date,
    weekdays: r.weekdays,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    excludedDates: r.excluded_dates ?? [],
    startTime: (r.start_time ?? "").slice(0, 5),
    endTime: (r.end_time ?? "").slice(0, 5),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface BlockInput {
  stage?: unknown;
  title?: unknown;
  color?: unknown;
  kind?: unknown;
  blockDate?: unknown;
  weekdays?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  excludedDates?: unknown;
  startTime?: unknown;
  endTime?: unknown;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// 'YYYY-MM-DD' or null.
function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Accept 'HH:MM' or 'HH:MM:SS', normalize to 'HH:MM'. null if invalid.
function normTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${m[1]}:${m[2]}`;
}

// Array of distinct 'YYYY-MM-DD' strings.
function normDates(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const set = new Set<string>();
  for (const d of v) if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  return [...set].sort();
}

// Array of distinct weekday ints 0-6, sorted. null if none valid.
function normWeekdays(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const set = new Set<number>();
  for (const n of v) {
    const d = Number(n);
    if (Number.isInteger(d) && d >= 0 && d <= 6) set.add(d);
  }
  return set.size ? [...set].sort((a, b) => a - b) : null;
}

// Validate a full block and build the DB row (snake_case) for insert/update.
// Rebuilding the whole row (rather than a partial patch) keeps the DB shape
// constraints satisfiable — PATCH merges changes onto the current block first.
export function buildBlockRow(input: BlockInput): { row: Record<string, unknown> } | { error: string } {
  const stage = typeof input.stage === "string" ? input.stage : "";
  if (!STAGE_SET.has(stage)) return { error: "stage must be a valid deal stage" };

  const kind: BlockKind = input.kind === "recurring" ? "recurring" : "one_off";
  const startTime = normTime(input.startTime);
  const endTime = normTime(input.endTime);
  if (!startTime || !endTime) return { error: "startTime and endTime are required (HH:MM)" };
  if (endTime <= startTime) return { error: "endTime must be after startTime" };

  const row: Record<string, unknown> = {
    stage,
    kind,
    title: strOrNull(input.title),
    color: strOrNull(input.color),
    start_time: startTime,
    end_time: endTime,
    updated_at: new Date().toISOString(),
  };

  if (kind === "one_off") {
    const date = dateOrNull(input.blockDate);
    if (!date) return { error: "blockDate (YYYY-MM-DD) is required for a one-off block" };
    row.block_date = date;
    row.weekdays = null;
    row.starts_on = null;
    row.ends_on = null;
    row.excluded_dates = [];
  } else {
    const weekdays = normWeekdays(input.weekdays);
    if (!weekdays) return { error: "weekdays (0-6) are required for a recurring block" };
    row.weekdays = weekdays;
    row.block_date = null;
    row.starts_on = dateOrNull(input.startsOn);
    row.ends_on = dateOrNull(input.endsOn);
    row.excluded_dates = normDates(input.excludedDates);
  }

  return { row };
}
