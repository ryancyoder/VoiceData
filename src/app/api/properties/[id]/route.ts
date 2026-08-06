import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as { cover_photo_id?: unknown };

  if (!("cover_photo_id" in body)) {
    return NextResponse.json({ error: "cover_photo_id is required" }, { status: 400 });
  }
  const coverPhotoId = body.cover_photo_id == null ? null : Number(body.cover_photo_id);

  if (coverPhotoId != null) {
    // A cover photo has to actually belong to this property — reached by
    // way of its event, the same as every other photo — otherwise a
    // mistaken id would silently attach a stranger's photo as the cover.
    const { data: photo, error: photoError } = await supabase
      .from("deal_photos")
      .select("event_id")
      .eq("id", coverPhotoId)
      .maybeSingle();
    if (photoError) {
      return NextResponse.json({ error: photoError.message }, { status: 500 });
    }
    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("property_id")
      .eq("id", photo.event_id)
      .maybeSingle();
    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }
    if (!event || String(event.property_id) !== id) {
      return NextResponse.json({ error: "That photo doesn't belong to this property" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("properties")
    .update({ cover_photo_id: coverPhotoId })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property: data });
}
