import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { MASTER_PHOTOS_BUCKET } from "@/lib/estimator/masterPhotos";

type RouteParams = { params: Promise<{ photoId: string }> };

// PATCH { is_cover: true } — make this photo its entity's cover.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { photoId } = await params;
  const body = (await req.json()) as { is_cover?: boolean };

  if (body.is_cover !== true) {
    return NextResponse.json({ error: "only setting is_cover: true is supported" }, { status: 400 });
  }

  const { data: photo, error: fetchError } = await supabase
    .from("master_photos")
    .select("entity_type, entity_id")
    .eq("id", photoId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "photo not found" }, { status: 404 });
  }

  // Clear the current cover first (the one-cover-per-entity unique index would
  // otherwise reject two covers), then set the new one.
  const { error: clearError } = await supabase
    .from("master_photos")
    .update({ is_cover: false })
    .eq("entity_type", photo.entity_type)
    .eq("entity_id", photo.entity_id)
    .eq("is_cover", true);
  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  const { error } = await supabase.from("master_photos").update({ is_cover: true }).eq("id", photoId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { photoId } = await params;

  const { data: photo, error: fetchError } = await supabase
    .from("master_photos")
    .select("storage_path, is_cover, entity_type, entity_id")
    .eq("id", photoId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "photo not found" }, { status: 404 });
  }

  const { error: delError } = await supabase.from("master_photos").delete().eq("id", photoId);
  if (delError) {
    return NextResponse.json({ error: delError.message }, { status: 500 });
  }
  await supabase.storage.from(MASTER_PHOTOS_BUCKET).remove([photo.storage_path]);

  // If we removed the cover, promote the oldest remaining photo to cover.
  let newCoverId: string | null = null;
  if (photo.is_cover) {
    const { data: next } = await supabase
      .from("master_photos")
      .select("id")
      .eq("entity_type", photo.entity_type)
      .eq("entity_id", photo.entity_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await supabase.from("master_photos").update({ is_cover: true }).eq("id", next.id);
      newCoverId = next.id;
    }
  }

  return NextResponse.json({ ok: true, newCoverId });
}
