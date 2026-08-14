import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ACTION_PHOTO_TYPE, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";
import { syncDealNextActionPhoto, removeTaskActionPhotos } from "@/lib/nextActionPhoto";

type RouteParams = { params: Promise<{ id: string }> };

// Mark an existing deal photo (e.g. a jobsite/event photo) as the deal's next
// action. Rather than a free-floating pointer, this moves the photo into the
// deal's Action section attached to the current next-action task. The photo's
// original event is remembered (source_event_id) so removing it as the next
// action restores it to that event instead of deleting it.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { source_photo_id?: number };
  const sourceId = body.source_photo_id != null ? Number(body.source_photo_id) : NaN;
  if (Number.isNaN(sourceId)) {
    return NextResponse.json({ error: "source_photo_id is required" }, { status: 400 });
  }

  // A next action is a task; there has to be one to attach the photo to.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id")
    .eq("deal_id", dealId)
    .eq("is_next_action", true)
    .maybeSingle();
  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }
  if (!task?.id) {
    return NextResponse.json({ error: "Set a next action for this deal first" }, { status: 400 });
  }

  const { data: photo, error: photoError } = await supabase
    .from("deal_photos")
    .select("id, deal_id, event_id, photo_type")
    .eq("id", sourceId)
    .maybeSingle();
  if (photoError) {
    return NextResponse.json({ error: photoError.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  // The photo must belong to this deal — directly or via its event.
  let belongs = photo.deal_id === dealId;
  if (!belongs && photo.event_id != null) {
    const { data: event } = await supabase.from("events").select("deal_id").eq("id", photo.event_id).maybeSingle();
    belongs = event?.deal_id === dealId;
  }
  if (!belongs) {
    return NextResponse.json({ error: "That photo doesn't belong to this deal" }, { status: 400 });
  }

  // Already an action photo: just (re)attach it to the next-action task.
  if (photo.photo_type === ACTION_PHOTO_TYPE) {
    await removeTaskActionPhotos(task.id, photo.id);
    await supabase.from("deal_photos").update({ task_id: task.id, deal_id: dealId }).eq("id", photo.id);
    await syncDealNextActionPhoto(dealId);
    const { data: fresh } = await supabase.from("deal_photos").select("*").eq("id", photo.id).single();
    return NextResponse.json({ photo: fresh, url: dealThumbUrl(fresh as DealPhoto) });
  }

  // Replace the task's current action photo (restoring/deleting it), then move
  // this photo into the Action section, remembering its original event.
  await removeTaskActionPhotos(task.id);
  const { data: moved, error } = await supabase
    .from("deal_photos")
    .update({
      source_event_id: photo.event_id,
      event_id: null,
      photo_type: ACTION_PHOTO_TYPE,
      task_id: task.id,
      deal_id: dealId,
    })
    .eq("id", sourceId)
    .select()
    .single();
  if (error || !moved) {
    return NextResponse.json({ error: error?.message || "Failed to mark photo" }, { status: 500 });
  }
  await syncDealNextActionPhoto(dealId);
  return NextResponse.json({ photo: moved, url: dealThumbUrl(moved as DealPhoto) });
}
