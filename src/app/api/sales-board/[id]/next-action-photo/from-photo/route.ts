import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ACTION_PHOTO_TYPE, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";
import { syncDealNextActionPhoto } from "@/lib/nextActionPhoto";

type RouteParams = { params: Promise<{ id: string }> };

// The task a newly-marked site photo should attach to. A deal's action photos
// accumulate — one per task — so this reuses the current next-action task only
// when it has no action photo yet; otherwise it creates a NEW blank-titled
// next-action task (making it the deal's next action) so the existing action
// photo is preserved rather than replaced.
async function resolveNextActionTask(dealId: number): Promise<{ taskId: number } | { error: string }> {
  const { data: current, error } = await supabase
    .from("tasks")
    .select("id")
    .eq("deal_id", dealId)
    .eq("is_next_action", true)
    .maybeSingle();
  if (error) return { error: error.message };

  if (current?.id != null) {
    const { data: existingPhoto } = await supabase
      .from("deal_photos")
      .select("id")
      .eq("task_id", current.id)
      .eq("photo_type", ACTION_PHOTO_TYPE)
      .limit(1)
      .maybeSingle();
    if (!existingPhoto) return { taskId: current.id };
  }

  // Create a fresh next-action task with a blank description. Clear the current
  // one first (one is_next_action task per deal).
  const { error: clearError } = await supabase
    .from("tasks")
    .update({ is_next_action: false })
    .eq("deal_id", dealId)
    .eq("is_next_action", true);
  if (clearError) return { error: clearError.message };
  const { data: created, error: createError } = await supabase
    .from("tasks")
    .insert({ deal_id: dealId, title: "", is_next_action: true })
    .select("id")
    .single();
  if (createError || !created) return { error: createError?.message || "Failed to create next-action task" };
  return { taskId: created.id };
}

// Mark an existing deal photo (e.g. a jobsite/event photo) as the deal's next
// action. Moves the photo into the deal's Action section attached to a
// next-action task — creating a new blank-titled task when the current next
// action already has a photo, so action photos accumulate instead of being
// replaced. The photo's original event is remembered (source_event_id) so
// removing it later restores it there.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { source_photo_id?: number };
  const sourceId = body.source_photo_id != null ? Number(body.source_photo_id) : NaN;
  if (Number.isNaN(sourceId)) {
    return NextResponse.json({ error: "source_photo_id is required" }, { status: 400 });
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
  if (photo.photo_type === ACTION_PHOTO_TYPE) {
    return NextResponse.json({ error: "That photo is already a next-action photo" }, { status: 400 });
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

  const target = await resolveNextActionTask(dealId);
  if ("error" in target) {
    return NextResponse.json({ error: target.error }, { status: 500 });
  }

  // Move the photo into the Action section, attached to the target task,
  // remembering its original event so removal can restore it.
  const { data: moved, error } = await supabase
    .from("deal_photos")
    .update({
      source_event_id: photo.event_id,
      event_id: null,
      photo_type: ACTION_PHOTO_TYPE,
      task_id: target.taskId,
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
