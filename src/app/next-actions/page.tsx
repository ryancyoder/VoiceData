import { supabase } from "@/lib/supabaseClient";
import { STAGES, dealThumbUrl, type DealPhoto, type Stage } from "@/lib/salesBoard";
import type { TaskPhoto } from "@/lib/tasks";
import NextActionsClient, { type NextActionRow } from "./NextActionsClient";

export const dynamic = "force-dynamic";

type RawDeal = {
  id: number;
  deal_name: string;
  stage: Stage;
  lost_at: string | null;
  proposal_number: string | null;
  proposal_description: string | null;
  appointment_date: string | null;
  proposal_date: string | null;
  won_date: string | null;
  start_date: string | null;
  invoiced_date: string | null;
  paid_date: string | null;
  next_action_photo_id: number | null;
  properties: {
    contacts: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
  } | null;
};

type RawTask = { id: number; deal_id: number | null; title: string; task_photos: TaskPhoto[] | null };

export default async function NextActionsPage() {
  const [dealsRes, tasksRes] = await Promise.all([
    supabase
      .from("Sales Board")
      .select(
        "id, deal_name, stage, lost_at, proposal_number, proposal_description, appointment_date, proposal_date, won_date, start_date, invoiced_date, paid_date, next_action_photo_id, properties(contacts(first_name, last_name, email, phone))"
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

  // The deal's chosen next-action photo (deal_photos row). Fetched with a
  // plain by-id query — deal_photos is a junction across events/deals/
  // properties, so embedding it would risk PostgREST ambiguity.
  const rawDeals = (dealsRes.data ?? []) as unknown as RawDeal[];
  const nextActionPhotoIds = [
    ...new Set(
      rawDeals.map((d) => d.next_action_photo_id).filter((v): v is number => v != null)
    ),
  ];
  const photoById = new Map<number, DealPhoto>();
  if (nextActionPhotoIds.length > 0) {
    const { data: photoRows } = await supabase.from("deal_photos").select("*").in("id", nextActionPhotoIds);
    for (const p of (photoRows ?? []) as unknown as DealPhoto[]) photoById.set(p.id, p);
  }

  const rows: NextActionRow[] = rawDeals
    .map((d) => {
      const task = nextActionByDeal.get(d.id) ?? null;
      const markedPhotoId = d.next_action_photo_id ?? null;
      const markedPhoto = markedPhotoId != null ? photoById.get(markedPhotoId) ?? null : null;
      return {
        id: d.id,
        dealName: d.deal_name,
        stage: d.stage,
        lostAt: d.lost_at,
        contactFirstName: d.properties?.contacts?.first_name ?? null,
        contactLastName: d.properties?.contacts?.last_name ?? null,
        contactPhone: d.properties?.contacts?.phone ?? null,
        contactEmail: d.properties?.contacts?.email ?? null,
        proposalNumber: d.proposal_number,
        proposalDescription: d.proposal_description,
        nextActionTaskId: task?.id ?? null,
        nextActionTitle: task?.title ?? "",
        nextActionPhotos: task?.task_photos ?? [],
        nextActionMarkedPhoto:
          markedPhoto != null ? { id: markedPhoto.id, url: dealThumbUrl(markedPhoto) } : null,
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
