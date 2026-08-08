import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ photoId: string }> };

// Update a photo's caption. Trimmed; blank clears it (stored as null).
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { photoId } = await params;
  const body = (await req.json()) as { caption?: string | null };

  if (!("caption" in body)) {
    return NextResponse.json({ error: "caption is required" }, { status: 400 });
  }

  const caption = typeof body.caption === "string" && body.caption.trim() ? body.caption.trim() : null;

  const { data, error } = await supabase
    .from("deal_photos")
    .update({ caption })
    .eq("id", photoId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ photo: data });
}

// A photo is reached only by way of its event, never a deal directly — this
// mirrors the deal-scoped delete route's own logic exactly, but without a
// deal in the URL, since not every photo's event has one.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { photoId } = await params;

  const { data: photo, error: fetchError } = await supabase
    .from("deal_photos")
    .select("storage_path, poster_path")
    .eq("id", photoId)
    .single();

  if (fetchError || !photo) {
    return NextResponse.json({ error: fetchError?.message || "Photo not found" }, { status: 404 });
  }

  const { error: deleteRowError } = await supabase.from("deal_photos").delete().eq("id", photoId);

  if (deleteRowError) {
    return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  }

  const paths = photo.poster_path ? [photo.storage_path, photo.poster_path] : [photo.storage_path];
  await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(paths);

  return NextResponse.json({ ok: true });
}
