export const TASK_CONTEXTS = ["Office", "Field", "Phone", "Design", "Errand", "Waiting"] as const;

export type TaskContext = (typeof TASK_CONTEXTS)[number];

export interface TaskDeal {
  id: number;
  deal_name: string;
  company: string | null;
  stage: string;
  lost_at: string | null;
}

export interface TaskPhoto {
  id: number;
  task_id: number;
  storage_path: string;
  file_name: string | null;
  created_at: string;
}

export const TASK_PHOTOS_BUCKET = "task-photos";

export function taskPhotoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${TASK_PHOTOS_BUCKET}/${storagePath}`;
}

export interface Task {
  id: number;
  deal_id: number | null;
  title: string;
  context: TaskContext | null;
  start_date: string | null;
  duration_hours: number | null;
  // Whether this is the one task designated as its deal's "next action" —
  // shown on the Sales Board card in place of what used to be a free-text
  // field. Only one task per deal can carry this at a time (enforced by a
  // partial unique index in the DB), and it requires a deal_id.
  is_next_action: boolean;
  // Null while open; set to the completion timestamp once done.
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Present when joined.
  deal: TaskDeal | null;
  photos: TaskPhoto[];
}

export interface TaskInput {
  title: string;
  deal_id?: number | null;
  context?: TaskContext | null;
  start_date?: string | null;
  duration_hours?: number | null;
  is_next_action?: boolean;
  completed_at?: string | null;
}

export function formatDealLabel(deal: Pick<TaskDeal, "deal_name" | "company">): string {
  return deal.company ? `${deal.deal_name} (${deal.company})` : deal.deal_name;
}

export function formatDuration(hours: number | null): string {
  if (hours == null) return "";
  const rounded = Math.round(hours * 100) / 100;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, "");
  return `${label} hr${rounded === 1 ? "" : "s"}`;
}
