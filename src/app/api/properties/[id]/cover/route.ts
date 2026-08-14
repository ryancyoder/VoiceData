import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// The property's album cover photo (properties.cover_photo_id → deal_photos),
// resolved to the full row so callers can render it. Two plain by-id queries
// on purpose — deal_photos is a junction across events/deals/properties, so
// embedding it risks PostgREST ambiguity. Returns { photo: null } when the
// property has no cover set.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: property, error: propError } = await supabase
    .from("properties")
    .select("cover_photo_id")
    .eq("id", id)
    .maybeSingle();
  if (propError) {
    return NextResponse.json({ error: propError.message }, { status: 500 });
  }
  const coverId = property?.cover_photo_id ?? null;
  if (coverId == null) {
    return NextResponse.json({ photo: null });
  }

  const { data: photo, error: photoError } = await supabase
    .from("deal_photos")
    .select("*")
    .eq("id", coverId)
    .maybeSingle();
  if (photoError) {
    return NextResponse.json({ error: photoError.message }, { status: 500 });
  }

  return NextResponse.json({ photo: photo ?? null });
}
