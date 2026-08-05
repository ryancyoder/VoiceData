import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";
import { resolvePhotoMetadata } from "@/lib/photoMetadata";

type RouteParams = { params: Promise<{ id: string }> };

// A photo's base-level attachment is to the event only — no deal is
// required. deal_id is inherited from the event only if the event already
// has one, and stays null otherwise (mirrors the event-scoped video route).
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file");
  const caption = formData.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  try {
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("deal_id")
      .eq("id", id)
      .maybeSingle();
    if (eventError || !event) {
      return NextResponse.json({ error: eventError?.message || "Event not found" }, { status: 404 });
    }

    const { latitude, longitude, takenAt } = await resolvePhotoMetadata(formData, file);

    const ext = safeExtension(file.name);
    const path = `event-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });

    if (uploadError) {
      console.error("Photo upload failed (storage):", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("deal_photos")
      .insert({
        deal_id: event.deal_id,
        event_id: Number(id),
        storage_path: path,
        caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
        latitude,
        longitude,
        taken_at: takenAt,
      })
      .select()
      .single();

    if (error) {
      console.error("Photo upload failed (db insert):", error);
      await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ photo: data }, { status: 201 });
  } catch (err) {
    console.error("Photo upload failed (unexpected):", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload photo" },
      { status: 500 }
    );
  }
}
