import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { MASTER_PHOTOS_BUCKET, masterPhotoUrl } from "@/lib/estimator/masterPhotos";
import { safeExtension } from "@/lib/storagePaths";

// Which base table owns each entity type — used to confirm the owner exists
// before attaching a photo (the master_photos table is polymorphic, so there
// is no FK to enforce it).
const OWNER_TABLE: Record<string, string> = {
  material: "materials",
  assembly: "assemblies",
  equipment: "equipment",
};

// POST multipart { file, entity_type, entity_id } — upload a photo for a
// material / assembly / equipment. The first photo for an entity is its cover.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  const entityType = String(formData.get("entity_type") ?? "");
  const entityId = String(formData.get("entity_id") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are supported" }, { status: 400 });
  }
  const ownerTable = OWNER_TABLE[entityType];
  if (!ownerTable) {
    return NextResponse.json({ error: "entity_type must be material, assembly, or equipment" }, { status: 400 });
  }
  if (!entityId) {
    return NextResponse.json({ error: "entity_id is required" }, { status: 400 });
  }

  // The owner must exist.
  const { data: owner, error: ownerError } = await supabase.from(ownerTable).select("id").eq("id", entityId).maybeSingle();
  if (ownerError) {
    return NextResponse.json({ error: ownerError.message }, { status: 500 });
  }
  if (!owner) {
    return NextResponse.json({ error: "Save the item before adding photos." }, { status: 404 });
  }

  // First photo for this entity becomes its cover.
  const { count, error: countError } = await supabase
    .from("master_photos")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  const isCover = (count ?? 0) === 0;

  const ext = safeExtension(file.name, "png");
  const path = `${entityType}/${entityId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(MASTER_PHOTOS_BUCKET)
    .upload(path, file, { contentType: file.type || "image/png" });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("master_photos")
    .insert({ entity_type: entityType, entity_id: entityId, storage_path: path, is_cover: isCover })
    .select("id, is_cover")
    .single();
  if (error) {
    await supabase.storage.from(MASTER_PHOTOS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { photo: { id: data.id, url: masterPhotoUrl(path), is_cover: data.is_cover }, key: `${entityType}:${entityId}` },
    { status: 201 }
  );
}
