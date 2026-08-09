import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { PLANT_IMAGES_BUCKET } from "@/lib/plants";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

// plantImageUrl() resolves a plant's photo by the *basename* of plants.image at
// the bucket root, so uploaded photos must be stored as a bare filename there.
// Existing catalog covers use a vault path ("PLANTS/…/x.jpeg") whose basename
// is a shared album cover — we only remove a previous object when it was one of
// our own uploads (a bare filename, i.e. no path separator).
function isOwnUpload(image: string | null | undefined): boolean {
  return !!image && !image.includes("/") && image.startsWith("plant-");
}

// Upload / replace the reference photo for a plant.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("plants")
    .select("image")
    .eq("id", plantId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const prevImage = (existing.image as string | null) ?? null;

  const ext = safeExtension(file.name, "jpg");
  const filename = `plant-${plantId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PLANT_IMAGES_BUCKET)
    .upload(filename, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: row, error } = await supabase
    .from("plants")
    .update({ image: filename, last_updated: new Date().toISOString() })
    .eq("id", plantId)
    .select("id, image")
    .maybeSingle();
  if (error) {
    await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([filename]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort cleanup of the previous upload now that the row points elsewhere.
  if (isOwnUpload(prevImage) && prevImage !== filename) {
    await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([prevImage as string]);
  }

  return NextResponse.json({ image: (row?.image as string | null) ?? filename });
}

// Clear a plant's photo (and remove the object if we uploaded it).
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("plants")
    .select("image")
    .eq("id", plantId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const prevImage = (existing.image as string | null) ?? null;

  const { error } = await supabase
    .from("plants")
    .update({ image: null, last_updated: new Date().toISOString() })
    .eq("id", plantId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (isOwnUpload(prevImage)) {
    await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([prevImage as string]);
  }

  return NextResponse.json({ ok: true });
}
