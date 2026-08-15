import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ACTION_PHOTO_TYPE, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string }> };

// Add an existing deal photo (e.g. a jobsite/event photo) to the deal's Action
// section as an action — a NEW task (one action photo per task). This does NOT
// make it the next action; promoting an action to the next action is a separate
// step (the ⚡ icon → PATCH the task's is_next_action). The task title comes
// from the photo's caption, or a title passed in when the photo has none (in
// which case that title is also stored as the photo's caption).
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { source_photo_id?: number; title?: string };
  const sourceId = body.source_photo_id != null ? Number(body.source_photo_id) : NaN;
  if (Number.isNaN(sourceId)) {
    return NextResponse.json({ error: "source_photo_id is required" }, { status: 400 });
  }

  const { data: photo, error: photoError } = await supabase
    .from("deal_photos")
    .select("id, deal_id, event_id, property_id, photo_type, caption, source_event_id")
    .eq("id", sourceId)
    .maybeSingle();
  if (photoError) {
    return NextResponse.json({ error: photoError.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  if (photo.photo_type === ACTION_PHOTO_TYPE) {
    return NextResponse.json({ error: "That photo is already an action" }, { status: 400 });
  }

  // The deal's property, for validating photos that reach it via the property
  // (e.g. a general-reference photo being dragged into a deal's actions).
  const { data: deal } = await supabase.from("Sales Board").select("property_id").eq("id", dealId).maybeSingle();

  // The photo must belong to this deal — directly, via its event, or via the
  // deal's property.
  let belongs = photo.deal_id === dealId;
  if (!belongs && photo.event_id != null) {
    const { data: event } = await supabase.from("events").select("deal_id").eq("id", photo.event_id).maybeSingle();
    belongs = event?.deal_id === dealId;
  }
  if (!belongs && photo.property_id != null && deal?.property_id != null) {
    belongs = photo.property_id === deal.property_id;
  }
  if (!belongs) {
    return NextResponse.json({ error: "That photo doesn't belong to this deal" }, { status: 400 });
  }

  // Title = the photo's caption, else the caption passed in (which we also store
  // on the photo so the caption and task title stay in sync).
  const existingCaption = photo.caption?.trim() || "";
  const providedTitle = (body.title ?? "").trim();
  const title = existingCaption || providedTitle;

  const { data: created, error: taskError } = await supabase
    .from("tasks")
    .insert({ deal_id: dealId, title, is_next_action: false })
    .select("id")
    .single();
  if (taskError || !created) {
    return NextResponse.json({ error: taskError?.message || "Failed to create action task" }, { status: 500 });
  }

  // Move the photo into the Action section attached to the new task, remembering
  // its original event so removal can restore it. Fill in the caption if empty.
  const { data: moved, error } = await supabase
    .from("deal_photos")
    .update({
      source_event_id: photo.source_event_id ?? photo.event_id,
      event_id: null,
      property_id: null,
      photo_type: ACTION_PHOTO_TYPE,
      task_id: created.id,
      deal_id: dealId,
      caption: existingCaption || providedTitle || null,
    })
    .eq("id", sourceId)
    .select()
    .single();
  if (error || !moved) {
    return NextResponse.json({ error: error?.message || "Failed to add action photo" }, { status: 500 });
  }
  return NextResponse.json({ photo: moved, url: dealThumbUrl(moved as DealPhoto) });
}
