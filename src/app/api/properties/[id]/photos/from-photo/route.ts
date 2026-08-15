import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { PROPERTY_REFERENCE_TYPE, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string }> };

// Move an existing deal/event photo into the property's General reference
// section — retag it as an event-less, deal-less property-reference photo. Its
// original event is remembered (source_event_id) for a possible restore.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const propertyId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { source_photo_id?: number };
  const sourceId = body.source_photo_id != null ? Number(body.source_photo_id) : NaN;
  if (Number.isNaN(sourceId)) {
    return NextResponse.json({ error: "source_photo_id is required" }, { status: 400 });
  }

  const { data: photo, error: photoError } = await supabase
    .from("deal_photos")
    .select("id, deal_id, event_id, property_id, photo_type")
    .eq("id", sourceId)
    .maybeSingle();
  if (photoError) {
    return NextResponse.json({ error: photoError.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  if (photo.photo_type === PROPERTY_REFERENCE_TYPE) {
    return NextResponse.json({ error: "That photo is already a reference photo" }, { status: 400 });
  }

  // The photo must belong to this property — directly, via its event, or via its
  // deal.
  let belongs = photo.property_id === propertyId;
  if (!belongs && photo.event_id != null) {
    const { data: event } = await supabase.from("events").select("property_id").eq("id", photo.event_id).maybeSingle();
    belongs = event?.property_id === propertyId;
  }
  if (!belongs && photo.deal_id != null) {
    const { data: deal } = await supabase.from("Sales Board").select("property_id").eq("id", photo.deal_id).maybeSingle();
    belongs = deal?.property_id === propertyId;
  }
  if (!belongs) {
    return NextResponse.json({ error: "That photo doesn't belong to this property" }, { status: 400 });
  }

  const { data: moved, error } = await supabase
    .from("deal_photos")
    .update({
      source_event_id: photo.event_id,
      event_id: null,
      deal_id: null,
      task_id: null,
      property_id: propertyId,
      photo_type: PROPERTY_REFERENCE_TYPE,
    })
    .eq("id", sourceId)
    .select()
    .single();
  if (error || !moved) {
    return NextResponse.json({ error: error?.message || "Failed to add reference photo" }, { status: 500 });
  }
  return NextResponse.json({ photo: moved, url: dealThumbUrl(moved as DealPhoto) });
}
