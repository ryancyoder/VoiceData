import { supabase } from "@/lib/supabaseClient";
import { STAGES, type Stage } from "@/lib/salesBoard";
import type { TaskPhoto } from "@/lib/tasks";
import type { EventType } from "@/lib/events";
import NextActionsClient, { type NextActionRow } from "./NextActionsClient";

export const dynamic = "force-dynamic";

type RawDeal = {
  id: number;
  deal_name: string;
  stage: Stage;
  lost_at: string | null;
  properties: { contacts: { last_name: string | null } | null } | null;
};

type RawTask = { id: number; deal_id: number | null; title: string; task_photos: TaskPhoto[] | null };

type RawTimelineEvent = { id: number; deal_id: number | null; name: string | null; start_time: string; event_type: EventType | null };

export default async function NextActionsPage() {
  const [dealsRes, tasksRes, eventsRes] = await Promise.all([
    supabase
      .from("Sales Board")
      .select("id, deal_name, stage, lost_at, properties(contacts(last_name))")
      .order("created_at", { ascending: true }),
    supabase
      .from("tasks")
      .select("id, deal_id, title, task_photos(id, task_id, storage_path, file_name, created_at)")
      .eq("is_next_action", true),
    supabase.from("events").select("id, deal_id, name, start_time, event_type").not("deal_id", "is", null),
  ]);

  if (dealsRes.error) {
    throw new Error(`Failed to load deals: ${dealsRes.error.message}`);
  }
  if (tasksRes.error) {
    throw new Error(`Failed to load next actions: ${tasksRes.error.message}`);
  }
  if (eventsRes.error) {
    throw new Error(`Failed to load timeline events: ${eventsRes.error.message}`);
  }

  const nextActionByDeal = new Map<number, RawTask>();
  for (const task of (tasksRes.data ?? []) as unknown as RawTask[]) {
    if (task.deal_id != null) nextActionByDeal.set(task.deal_id, task);
  }

  const eventsByDeal = new Map<number, RawTimelineEvent[]>();
  for (const event of (eventsRes.data ?? []) as unknown as RawTimelineEvent[]) {
    if (event.deal_id == null) continue;
    const list = eventsByDeal.get(event.deal_id);
    if (list) list.push(event);
    else eventsByDeal.set(event.deal_id, [event]);
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
        timelineEvents: (eventsByDeal.get(d.id) ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          start_time: e.start_time,
          event_type: e.event_type,
        })),
      };
    })
    .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));

  return <NextActionsClient initialRows={rows} />;
}
