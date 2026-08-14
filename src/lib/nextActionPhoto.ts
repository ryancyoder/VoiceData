import { supabase } from "@/lib/supabaseClient";
import { ACTION_PHOTO_TYPE } from "@/lib/salesBoard";

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
