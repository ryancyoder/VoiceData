import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";
import { syncDealNextActionPhoto } from "@/lib/nextActionPhoto";

type RouteParams = { params: Promise<{ id: string }> };

// Move a "filed" photo (a deal's action photo, or a property-reference photo)
// (back) into a calendar event — the reverse of dragging it into the Action or
// General reference section. It becomes an ordinary event photo of that event's
// deal.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const eventId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { source_photo_id?: number };
  const sourceId = body.source_photo_id != null ? Number(body.source_photo_id) : NaN;
  if (Number.isNaN(sourceId)) {
    return NextResponse.json({ error: "source_photo_id is required" }, { status: 400 });
  }

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, deal_id, property_id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { data: photo, error: photoError } = await supabase
    .from("deal_photos")
    .select("id, deal_id, property_id, event_id, task_id, photo_type")
    .eq("id", sourceId)
    .maybeSingle();
  if (photoError) {
    return NextResponse.json({ error: photoError.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  // Only filed photos (photo_type set — action / reference) move back to events.
  if (photo.photo_type == null) {
    return NextResponse.json({ error: "That photo is already in an event" }, { status: 400 });
  }

  // Best-effort: the photo must be at the same property as the event.
  let photoPropertyId = photo.property_id;
  if (photoPropertyId == null && photo.deal_id != null) {
    const { data: d } = await supabase.from("Sales Board").select("property_id").eq("id", photo.deal_id).maybeSingle();
    photoPropertyId = d?.property_id ?? null;
  }
  if (event.property_id != null && photoPropertyId != null && event.property_id !== photoPropertyId) {
    return NextResponse.json({ error: "That photo doesn't belong to this event's property" }, { status: 400 });
  }

  const formerDealId = photo.deal_id;
  const wasAction = photo.task_id != null;

  const { data: moved, error } = await supabase
    .from("deal_photos")
    .update({
      event_id: eventId,
      deal_id: event.deal_id,
      property_id: null,
      photo_type: null,
      task_id: null,
      source_event_id: null,
    })
    .eq("id", sourceId)
    .select()
    .single();
  if (error || !moved) {
    return NextResponse.json({ error: error?.message || "Failed to move photo" }, { status: 500 });
  }

  // A moved action photo may have been its deal's next action — re-derive it.
  if (wasAction && formerDealId != null) {
    await syncDealNextActionPhoto(formerDealId);
  }
  return NextResponse.json({ photo: moved, url: dealThumbUrl(moved as DealPhoto) });
}
