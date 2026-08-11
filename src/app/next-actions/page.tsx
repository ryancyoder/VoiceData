import { supabase } from "@/lib/supabaseClient";
import { STAGES, type Stage } from "@/lib/salesBoard";
import type { TaskPhoto } from "@/lib/tasks";
import NextActionsClient, { type NextActionRow } from "./NextActionsClient";

export const dynamic = "force-dynamic";

type RawDeal = {
  id: number;
  deal_name: string;
  stage: Stage;
  lost_at: string | null;
  appointment_date: string | null;
  proposal_date: string | null;
  won_date: string | null;
  start_date: string | null;
  invoiced_date: string | null;
  paid_date: string | null;
  properties: { contacts: { last_name: string | null } | null } | null;
};

type RawTask = { id: number; deal_id: number | null; title: string; task_photos: TaskPhoto[] | null };

export default async function NextActionsPage() {
  const [dealsRes, tasksRes] = await Promise.all([
    supabase
      .from("Sales Board")
      .select(
        "id, deal_name, stage, lost_at, appointment_date, proposal_date, won_date, start_date, invoiced_date, paid_date, properties(contacts(last_name))"
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("tasks")
      .select("id, deal_id, title, task_photos(id, task_id, storage_path, file_name, created_at)")
      .eq("is_next_action", true),
  ]);

  if (dealsRes.error) {
    throw new Error(`Failed to load deals: ${dealsRes.error.message}`);
  }
  if (tasksRes.error) {
    throw new Error(`Failed to load next actions: ${tasksRes.error.message}`);
  }

  const nextActionByDeal = new Map<number, RawTask>();
  for (const task of (tasksRes.data ?? []) as unknown as RawTask[]) {
    if (task.deal_id != null) nextActionByDeal.set(task.deal_id, task);
  }

  const rows: NextActionRow[] = ((dealsRes.data ?? []) as unknown as RawDeal[])
    .map((d) => {
      const task = nextActionByDeal.get(d.id) ?? null;
      return {
        id: d.id,
        dealName: d.deal_name,
        stage: d.stage,
        lostAt: d.lost_at,
        contactLastName: d.properties?.contacts?.last_name ?? null,
        nextActionTaskId: task?.id ?? null,
        nextActionTitle: task?.title ?? "",
        nextActionPhotos: task?.task_photos ?? [],
        // Timeline milestones come straight from the deal's per-stage dates.
        milestoneDates: {
          appointment: d.appointment_date,
          proposal: d.proposal_date,
          won: d.won_date,
          production: d.start_date, // production start date
          invoiced: d.invoiced_date,
          paid: d.paid_date,
        },
      };
    })
    .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));

  return <NextActionsClient initialRows={rows} />;
}
