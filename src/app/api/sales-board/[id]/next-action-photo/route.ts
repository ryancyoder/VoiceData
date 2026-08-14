import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ACTION_PHOTO_TYPE, DEAL_PHOTOS_BUCKET, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";
import { resolvePhotoMetadata } from "@/lib/photoMetadata";

type RouteParams = { params: Promise<{ id: string }> };

// Remove every ACTION-type photo attached to a deal (rows + storage), except an
// optionally-kept id. Enforces one action photo per deal ("replace the old").
async function clearActionPhotos(dealId: number, keepId?: number) {
  let query = supabase
    .from("deal_photos")
    .select("id, storage_path")
    .eq("deal_id", dealId)
    .eq("photo_type", ACTION_PHOTO_TYPE);
  if (keepId != null) query = query.neq("id", keepId);
  const { data: old } = await query;
  const rows = (old ?? []) as { id: number; storage_path: string }[];
  if (rows.length === 0) return;
  const paths = rows.map((r) => r.storage_path).filter(Boolean);
  if (paths.length > 0) await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(paths);
  await supabase
    .from("deal_photos")
    .delete()
    .in("id", rows.map((r) => r.id));
}

// Upload a deal's next-action photo: an event-less deal photo (deal_id set,
// event_id null, photo_type Action_Photo) that lands in the deal's "Action"
// gallery section, replaces any previous action photo, and becomes the deal's
// next_action_photo_id.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);
  const formData = await req.formData();
  const file = formData.get("file");
  const caption = formData.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only images are supported" }, { status: 400 });
  }

  try {
    const { data: deal, error: dealError } = await supabase
      .from("Sales Board")
      .select("id")
      .eq("id", dealId)
      .maybeSingle();
    if (dealError || !deal) {
      return NextResponse.json({ error: dealError?.message || "Deal not found" }, { status: 404 });
    }

    const { latitude, longitude, takenAt } = await resolvePhotoMetadata(formData, file);

    const ext = safeExtension(file.name);
    const path = `deal-${dealId}/action/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      console.error("Action photo upload failed (storage):", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: photo, error } = await supabase
      .from("deal_photos")
      .insert({
        deal_id: dealId,
        event_id: null,
        property_id: null,
        photo_type: ACTION_PHOTO_TYPE,
        storage_path: path,
        caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
        latitude,
        longitude,
        taken_at: takenAt,
      })
      .select()
      .single();

    if (error || !photo) {
      console.error("Action photo upload failed (db insert):", error);
      await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([path]);
      return NextResponse.json({ error: error?.message || "Failed to save photo" }, { status: 500 });
    }

    // Replace the old action photo, then point the deal at the new one.
    await clearActionPhotos(dealId, photo.id);
    const { error: markError } = await supabase
      .from("Sales Board")
      .update({ next_action_photo_id: photo.id })
      .eq("id", dealId);
    if (markError) {
      console.error("Action photo mark failed:", markError);
      return NextResponse.json({ error: markError.message }, { status: 500 });
    }

    return NextResponse.json({ photo, url: dealThumbUrl(photo as DealPhoto) }, { status: 201 });
  } catch (err) {
    console.error("Action photo upload failed (unexpected):", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload photo" },
      { status: 500 }
    );
  }
}

// Remove the deal's next-action photo: unset next_action_photo_id and delete any
// uploaded ACTION-type photo (a jobsite photo merely marked in the gallery is
// only un-marked, never deleted).
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);

  const { error: markError } = await supabase
    .from("Sales Board")
    .update({ next_action_photo_id: null })
    .eq("id", dealId);
  if (markError) {
    return NextResponse.json({ error: markError.message }, { status: 500 });
  }
  await clearActionPhotos(dealId);
  return NextResponse.json({ ok: true });
}
