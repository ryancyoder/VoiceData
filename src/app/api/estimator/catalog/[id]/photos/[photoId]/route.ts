import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { CATALOG_PHOTOS_BUCKET } from "@/lib/estimator/catalogPhotos";

type RouteParams = { params: Promise<{ id: string; photoId: string }> };

// PATCH { is_cover: true } — make this photo the item's cover.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id, photoId } = await params;
  const body = (await req.json()) as { is_cover?: boolean };

  if (body.is_cover !== true) {
    return NextResponse.json({ error: "only setting is_cover: true is supported" }, { status: 400 });
  }

  // Clear the existing cover first (the one-cover-per-item unique index would
  // otherwise reject two covers), then set the new one.
  const { error: clearError } = await supabase
    .from("catalog_item_photos")
    .update({ is_cover: false })
    .eq("catalog_item_id", id)
    .eq("is_cover", true);
  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  const { error } = await supabase
    .from("catalog_item_photos")
    .update({ is_cover: true })
    .eq("id", photoId)
    .eq("catalog_item_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id, photoId } = await params;

  const { data: photo, error: fetchError } = await supabase
    .from("catalog_item_photos")
    .select("storage_path, is_cover")
    .eq("id", photoId)
    .eq("catalog_item_id", id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "photo not found" }, { status: 404 });
  }

  const { error: delError } = await supabase.from("catalog_item_photos").delete().eq("id", photoId);
  if (delError) {
    return NextResponse.json({ error: delError.message }, { status: 500 });
  }
  await supabase.storage.from(CATALOG_PHOTOS_BUCKET).remove([photo.storage_path]);

  // If we removed the cover, promote the oldest remaining photo to cover.
  let newCoverId: string | null = null;
  if (photo.is_cover) {
    const { data: next } = await supabase
      .from("catalog_item_photos")
      .select("id")
      .eq("catalog_item_id", id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await supabase.from("catalog_item_photos").update({ is_cover: true }).eq("id", next.id);
      newCoverId = next.id;
    }
  }

  return NextResponse.json({ ok: true, newCoverId });
}
