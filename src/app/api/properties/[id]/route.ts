import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { upsertPropertyContact } from "@/lib/contacts";
import { geocodeAddress } from "@/lib/geocode";

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
    address?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    email?: unknown;
    phone?: unknown;
  };

  const hasCoverPhoto = "cover_photo_id" in body;
  const hasNextActionPhoto = "next_action_photo_id" in body;
  const hasLocation = "latitude" in body || "longitude" in body;
  const hasAddress = "address" in body;
  // The property page's edit form always sends the full contact, so any one of
  // these keys means "apply the contact fields".
  const hasContact =
    "first_name" in body || "last_name" in body || "email" in body || "phone" in body;
  if (!hasCoverPhoto && !hasNextActionPhoto && !hasLocation && !hasAddress && !hasContact) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  // Editing the address: re-geocode so the map pin follows it. A blank address
  // is rejected — a property must always have one.
  if (hasAddress) {
    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (!address) {
      return NextResponse.json({ error: "address cannot be empty" }, { status: 400 });
    }
    const { data: current, error: currentError } = await supabase
      .from("properties")
      .select("address")
      .eq("id", id)
      .maybeSingle();
    if (currentError) {
      return NextResponse.json({ error: currentError.message }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    updates.address = address;
    if (address !== current.address) {
      const geocoded = await geocodeAddress(address);
      updates.latitude = geocoded?.latitude ?? null;
      updates.longitude = geocoded?.longitude ?? null;
      updates.geocoded_at = geocoded ? new Date().toISOString() : null;
    }
  }

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

  // Only touch the properties row when there's actually a column to write —
  // a contact-only edit leaves it alone.
  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from("properties").update(updates).eq("id", id);
    if (error) {
      // Duplicate address (unique index on address).
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "A property with that address already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (hasContact) {
    try {
      await upsertPropertyContact(Number(id), {
        first_name: typeof body.first_name === "string" ? body.first_name.trim() || null : null,
        last_name: typeof body.last_name === "string" ? body.last_name.trim() || null : null,
        email: typeof body.email === "string" ? body.email.trim() || null : null,
        phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to update contact" },
        { status: 500 }
      );
    }
  }

  // Return the full property with its contact, in the same shape the page's
  // list rows use (contact, singular).
  const { data: withContact, error: fetchError } = await supabase
    .from("properties")
    .select("*, contacts(*)")
    .eq("id", id)
    .single();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  const { contacts, ...propertyFields } = withContact as typeof withContact & { contacts: unknown };
  return NextResponse.json({ property: { ...propertyFields, contact: contacts ?? null } });
}
