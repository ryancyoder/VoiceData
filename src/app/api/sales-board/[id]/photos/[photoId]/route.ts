import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string; photoId: string }> };

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { photoId } = await params;

  const { data: photo, error: fetchError } = await supabase
    .from("deal_photos")
    .select("storage_path")
    .eq("id", photoId)
    .single();

  if (fetchError || !photo) {
    return NextResponse.json({ error: fetchError?.message || "Photo not found" }, { status: 404 });
  }

  const { error: deleteRowError } = await supabase
    .from("deal_photos")
    .delete()
    .eq("id", photoId);

  if (deleteRowError) {
    return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  }

  await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([photo.storage_path]);

  return NextResponse.json({ ok: true });
}
