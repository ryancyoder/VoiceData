import { supabase } from "@/lib/supabaseClient";
import { ACTION_PHOTO_TYPE, DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";

// Remove a task's action photos, sparing an optionally-kept id. A photo that
// was moved in from a jobsite event (source_event_id set) is restored to that
// event rather than destroyed; a genuinely-uploaded action photo is deleted
// (row + storage). This backs both "replace the action photo" and "remove it".
export async function removeTaskActionPhotos(taskId: number, keepId?: number): Promise<void> {
  let query = supabase
    .from("deal_photos")
    .select("id, storage_path, source_event_id")
    .eq("task_id", taskId)
    .eq("photo_type", ACTION_PHOTO_TYPE);
  if (keepId != null) query = query.neq("id", keepId);
  const { data } = await query;
  const rows = (data ?? []) as { id: number; storage_path: string; source_event_id: number | null }[];
  for (const r of rows) {
    if (r.source_event_id != null) {
      await supabase
        .from("deal_photos")
        .update({ event_id: r.source_event_id, source_event_id: null, task_id: null, photo_type: null })
        .eq("id", r.id);
    } else {
      if (r.storage_path) await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([r.storage_path]);
      await supabase.from("deal_photos").delete().eq("id", r.id);
    }
  }
}

// A deal's next-action photo has a single source of truth: the action photo
// attached to whichever task is the deal's is_next_action. This recomputes
// Sales Board.next_action_photo_id from that task's latest action photo (or
// null when the next-action task has no photo, or there is no next-action
// task). Call it after anything that changes the next-action task or its
// action photo, so the pointer can never drift from the marked action.
export async function syncDealNextActionPhoto(dealId: number): Promise<void> {
  const { data: task } = await supabase
    .from("tasks")
    .select("id")
    .eq("deal_id", dealId)
    .eq("is_next_action", true)
    .maybeSingle();

  let photoId: number | null = null;
  if (task?.id != null) {
    const { data: photo } = await supabase
      .from("deal_photos")
      .select("id")
      .eq("task_id", task.id)
      .eq("photo_type", ACTION_PHOTO_TYPE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    photoId = photo?.id ?? null;
  }

  await supabase.from("Sales Board").update({ next_action_photo_id: photoId }).eq("id", dealId);
}
