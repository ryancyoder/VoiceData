import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ photoId: string }> };

// Directory of a storage path ("deal-12/abc.jpg" -> "deal-12"), or "" when the
// path has no folder. Annotated files are written alongside their original.
function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// Save an annotated (composited) copy of a photo. The un-annotated original is
// preserved so the edit can be reverted: on the first annotation we stash the
// current path in original_storage_path and point storage_path at the new
// composite; re-annotating replaces the composite but keeps that same original.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { photoId } = await params;
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const { data: photo, error: fetchError } = await supabase
    .from("deal_photos")
    .select("storage_path, original_storage_path, media_type")
    .eq("id", photoId)
    .single();

  if (fetchError || !photo) {
    return NextResponse.json({ error: fetchError?.message || "Photo not found" }, { status: 404 });
  }

  if (photo.media_type === "video") {
    return NextResponse.json({ error: "Videos cannot be annotated" }, { status: 400 });
  }

  // The true original is whatever was there before the very first annotation.
  const originalPath: string = photo.original_storage_path ?? photo.storage_path;
  const previousPath: string = photo.storage_path;

  const dir = dirOf(originalPath);
  const newPath = `${dir ? `${dir}/` : ""}annotated-${Date.now()}-${crypto.randomUUID()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(DEAL_PHOTOS_BUCKET)
    .upload(newPath, file, { contentType: "image/jpeg" });

  if (uploadError) {
    console.error("Annotation upload failed (storage):", uploadError);
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("deal_photos")
    .update({ storage_path: newPath, original_storage_path: originalPath })
    .eq("id", photoId)
    .select()
    .single();

  if (error) {
    console.error("Annotation save failed (db update):", error);
    await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([newPath]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Clean up the previous composite (never the true original) so re-annotating
  // the same photo doesn't leave orphaned files behind. Best-effort.
  if (previousPath !== originalPath && previousPath !== newPath) {
    await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([previousPath]);
  }

  return NextResponse.json({ photo: data });
}

// Revert an annotated photo back to its stored original: restore storage_path
// from original_storage_path, clear the marker, and delete the composite file.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { photoId } = await params;

  const { data: photo, error: fetchError } = await supabase
    .from("deal_photos")
    .select("storage_path, original_storage_path")
    .eq("id", photoId)
    .single();

  if (fetchError || !photo) {
    return NextResponse.json({ error: fetchError?.message || "Photo not found" }, { status: 404 });
  }

  if (!photo.original_storage_path) {
    return NextResponse.json({ error: "This photo has no annotation to revert" }, { status: 400 });
  }

  const annotatedPath: string = photo.storage_path;
  const originalPath: string = photo.original_storage_path;

  const { data, error } = await supabase
    .from("deal_photos")
    .update({ storage_path: originalPath, original_storage_path: null })
    .eq("id", photoId)
    .select()
    .single();

  if (error) {
    console.error("Annotation revert failed (db update):", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (annotatedPath !== originalPath) {
    await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([annotatedPath]);
  }

  return NextResponse.json({ photo: data });
}
