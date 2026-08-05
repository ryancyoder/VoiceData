import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string; photoId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { photoId } = await params;
  const body = (await req.json()) as { event_id?: unknown };
  if (!("event_id" in body)) {
    return NextResponse.json({ error: "event_id is required" }, { status: 400 });
  }
  const eventId = body.event_id == null ? null : Number(body.event_id);

  const { data: photo, error: fetchError } = await supabase
    .from("deal_photos")
    .select("event_id")
    .eq("id", photoId)
    .single();
  if (fetchError || !photo) {
    return NextResponse.json({ error: fetchError?.message || "Photo not found" }, { status: 404 });
  }
  const previousEventId = photo.event_id as number | null;

  const { data: updated, error: updateError } = await supabase
    .from("deal_photos")
    .update({ event_id: eventId })
    .eq("id", photoId)
    .select()
    .single();
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // If the photo's old event now has no photos left, it's dead weight — remove it.
  if (previousEventId != null && previousEventId !== eventId) {
    const { count } = await supabase
      .from("deal_photos")
      .select("id", { count: "exact", head: true })
      .eq("event_id", previousEventId);
    if (count === 0) {
      await supabase.from("events").delete().eq("id", previousEventId);
    }
  }

  return NextResponse.json({ photo: updated });
}

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

  const { error: deleteRowError } = await supabase
    .from("deal_photos")
    .delete()
    .eq("id", photoId);

  if (deleteRowError) {
    return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  }

  const paths = photo.poster_path ? [photo.storage_path, photo.poster_path] : [photo.storage_path];
  await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(paths);

  return NextResponse.json({ ok: true });
}
