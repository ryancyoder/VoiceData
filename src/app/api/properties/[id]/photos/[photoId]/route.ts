import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET, PROPERTY_REFERENCE_TYPE } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string; photoId: string }> };

// Delete one of a property's general-reference photos. Scoped to the
// property + Property_Reference type so this can only ever remove a
// reference photo, never an event/jobsite photo that happens to share the
// deal_photos table.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id, photoId } = await params;

  const { data: photo, error: fetchError } = await supabase
    .from("deal_photos")
    .select("storage_path, poster_path, property_id, photo_type")
    .eq("id", photoId)
    .single();

  if (fetchError || !photo) {
    return NextResponse.json({ error: fetchError?.message || "Photo not found" }, { status: 404 });
  }
  if (photo.property_id !== Number(id) || photo.photo_type !== PROPERTY_REFERENCE_TYPE) {
    return NextResponse.json({ error: "Not a reference photo of this property" }, { status: 400 });
  }

  const { error: deleteRowError } = await supabase.from("deal_photos").delete().eq("id", photoId);
  if (deleteRowError) {
    return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  }

  const paths = photo.poster_path ? [photo.storage_path, photo.poster_path] : [photo.storage_path];
  await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(paths);

  return NextResponse.json({ ok: true });
}
