import { supabase } from "@/lib/supabaseClient";
import type { Task, TaskDeal } from "@/lib/tasks";
import TasksClient from "./TasksClient";

export const dynamic = "force-dynamic";

const TASK_SELECT =
  '*, deal:"Sales Board"(id, deal_name, company, stage, lost_at), photos:task_photos(id, task_id, storage_path, file_name, created_at)';

export default async function TasksPage() {
  const [tasksRes, dealsRes] = await Promise.all([
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .order("start_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase.from("Sales Board").select("id, deal_name, company, stage, lost_at").order("deal_name", { ascending: true }),
  ]);

  if (tasksRes.error) {
    throw new Error(`Failed to load tasks: ${tasksRes.error.message}`);
  }
  if (dealsRes.error) {
    throw new Error(`Failed to load tasks: ${dealsRes.error.message}`);
  }

  return <TasksClient initialTasks={(tasksRes.data ?? []) as Task[]} dealOptions={(dealsRes.data ?? []) as TaskDeal[]} />;
}
