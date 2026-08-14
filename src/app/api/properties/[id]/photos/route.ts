import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET, PROPERTY_REFERENCE_TYPE } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";
import { resolvePhotoMetadata } from "@/lib/photoMetadata";

type RouteParams = { params: Promise<{ id: string }> };

// List a property's general-reference photos, newest first. A plain,
// single-table query on purpose: deal_photos is a junction across
// events/deals/properties, so any cross-table embed risks PostgREST
// ambiguity (see the Photos page loader for the same guard).
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { data, error } = await supabase
    .from("deal_photos")
    .select("*")
    .eq("property_id", Number(id))
    .eq("photo_type", PROPERTY_REFERENCE_TYPE)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ photos: data ?? [] });
}

// A general-reference photo of the property — event-less and deal-less
// (property_id set, event_id/deal_id null, photo_type Property_Reference).
// Mirrors the event photo route but attaches to a property directly.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file");
  const caption = formData.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  try {
    const { data: property, error: propError } = await supabase
      .from("properties")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (propError || !property) {
      return NextResponse.json({ error: propError?.message || "Property not found" }, { status: 404 });
    }

    const { latitude, longitude, takenAt } = await resolvePhotoMetadata(formData, file);

    const ext = safeExtension(file.name);
    const path = `property-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      console.error("Property photo upload failed (storage):", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("deal_photos")
      .insert({
        property_id: Number(id),
        deal_id: null,
        event_id: null,
        photo_type: PROPERTY_REFERENCE_TYPE,
        storage_path: path,
        caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
        latitude,
        longitude,
        taken_at: takenAt,
      })
      .select()
      .single();

    if (error) {
      console.error("Property photo upload failed (db insert):", error);
      await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ photo: data }, { status: 201 });
  } catch (err) {
    console.error("Property photo upload failed (unexpected):", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload photo" },
      { status: 500 }
    );
  }
}
