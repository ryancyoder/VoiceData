import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ACTION_PHOTO_TYPE, DEAL_PHOTOS_BUCKET, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";
import { resolvePhotoMetadata } from "@/lib/photoMetadata";
import { syncDealNextActionPhoto } from "@/lib/nextActionPhoto";

type RouteParams = { params: Promise<{ id: string }> };

// Remove a task's ACTION-type photos (rows + storage), except an optionally-kept
// id. Enforces one action photo per task ("replace the old").
async function clearTaskActionPhotos(taskId: number, keepId?: number) {
  let query = supabase
    .from("deal_photos")
    .select("id, storage_path")
    .eq("task_id", taskId)
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
// event_id null, photo_type Action_Photo) attached to the deal's next-action
// task (task_id). It lands in the deal album's "Action" section, replaces that
// task's previous action photo, and — via the sync — becomes the deal's
// next_action_photo_id when this task is the current next action.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);
  const formData = await req.formData();
  const file = formData.get("file");
  const taskIdRaw = formData.get("task_id");
  const caption = formData.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only images are supported" }, { status: 400 });
  }
  const taskId = taskIdRaw != null && String(taskIdRaw).trim() ? Number(taskIdRaw) : null;
  if (taskId == null || Number.isNaN(taskId)) {
    return NextResponse.json({ error: "task_id is required — an action photo belongs to a task" }, { status: 400 });
  }

  try {
    // The task must exist and belong to this deal.
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, deal_id")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError || !task) {
      return NextResponse.json({ error: taskError?.message || "Task not found" }, { status: 404 });
    }
    if (task.deal_id !== dealId) {
      return NextResponse.json({ error: "That task doesn't belong to this deal" }, { status: 400 });
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
        task_id: taskId,
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

    // One photo per task, then re-derive the deal's next-action photo.
    await clearTaskActionPhotos(taskId, photo.id);
    await syncDealNextActionPhoto(dealId);

    return NextResponse.json({ photo, url: dealThumbUrl(photo as DealPhoto) }, { status: 201 });
  } catch (err) {
    console.error("Action photo upload failed (unexpected):", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload photo" },
      { status: 500 }
    );
  }
}

// Remove a task's action photo (rows + storage), then re-derive the deal's
// next-action photo pointer.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);
  const taskIdRaw = req.nextUrl.searchParams.get("task_id");
  const taskId = taskIdRaw && taskIdRaw.trim() ? Number(taskIdRaw) : null;
  if (taskId == null || Number.isNaN(taskId)) {
    return NextResponse.json({ error: "task_id is required" }, { status: 400 });
  }

  await clearTaskActionPhotos(taskId);
  await syncDealNextActionPhoto(dealId);
  return NextResponse.json({ ok: true });
}
