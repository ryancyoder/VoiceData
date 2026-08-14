import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// A photo picked as a property's cover or next-action photo has to actually
// belong to this property — either a general-reference photo attached to the
// property directly, or an ordinary photo reached by way of its event —
// otherwise a mistaken id would silently attach a stranger's photo. Returns
// an error NextResponse when it doesn't belong, or null when it's valid.
async function validatePhotoBelongsToProperty(photoId: number, propertyId: string): Promise<NextResponse | null> {
  const { data: photo, error: photoError } = await supabase
    .from("deal_photos")
    .select("event_id, property_id")
    .eq("id", photoId)
    .maybeSingle();
  if (photoError) {
    return NextResponse.json({ error: photoError.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  // Direct property-reference photo: belongs if its property_id matches.
  if (photo.property_id != null) {
    if (String(photo.property_id) !== propertyId) {
      return NextResponse.json({ error: "That photo doesn't belong to this property" }, { status: 400 });
    }
    return null;
  }
  // Otherwise validate via its event's property.
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("property_id")
    .eq("id", photo.event_id)
    .maybeSingle();
  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }
  if (!event || String(event.property_id) !== propertyId) {
    return NextResponse.json({ error: "That photo doesn't belong to this property" }, { status: 400 });
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as {
    cover_photo_id?: unknown;
    next_action_photo_id?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  };

  const hasCoverPhoto = "cover_photo_id" in body;
  const hasNextActionPhoto = "next_action_photo_id" in body;
  const hasLocation = "latitude" in body || "longitude" in body;
  if (!hasCoverPhoto && !hasNextActionPhoto && !hasLocation) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (hasCoverPhoto) {
    const coverPhotoId = body.cover_photo_id == null ? null : Number(body.cover_photo_id);
    if (coverPhotoId != null) {
      const invalid = await validatePhotoBelongsToProperty(coverPhotoId, id);
      if (invalid) return invalid;
    }
    updates.cover_photo_id = coverPhotoId;
  }

  if (hasNextActionPhoto) {
    const nextActionPhotoId = body.next_action_photo_id == null ? null : Number(body.next_action_photo_id);
    if (nextActionPhotoId != null) {
      const invalid = await validatePhotoBelongsToProperty(nextActionPhotoId, id);
      if (invalid) return invalid;
    }
    updates.next_action_photo_id = nextActionPhotoId;
  }

  // A manually-dropped pin — the fallback for an address the automatic
  // geocoder (Nominatim) can't resolve at all, which otherwise leaves a
  // property with no coordinates forever. Both fields are required together
  // since a lone latitude or longitude isn't a usable point.
  if (hasLocation) {
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return NextResponse.json({ error: "latitude must be a number between -90 and 90" }, { status: 400 });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: "longitude must be a number between -180 and 180" }, { status: 400 });
    }
    updates.latitude = latitude;
    updates.longitude = longitude;
    updates.geocoded_at = new Date().toISOString();
  }

  const { data, error } = await supabase.from("properties").update(updates).eq("id", id).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property: data });
}
