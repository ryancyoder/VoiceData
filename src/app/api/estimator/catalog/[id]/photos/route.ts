import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { CATALOG_PHOTOS_BUCKET, catalogPhotoUrl } from "@/lib/estimator/catalogPhotos";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are supported" }, { status: 400 });
  }

  // The catalog item must already exist (FK). Newly-added items must be saved first.
  const { data: item, error: itemError } = await supabase
    .from("catalog_items")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (itemError) {
    return NextResponse.json({ error: itemError.message }, { status: 500 });
  }
  if (!item) {
    return NextResponse.json({ error: "Save the item before adding photos." }, { status: 404 });
  }

  // First photo for an item becomes its cover.
  const { count, error: countError } = await supabase
    .from("catalog_item_photos")
    .select("id", { count: "exact", head: true })
    .eq("catalog_item_id", id);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  const isCover = (count ?? 0) === 0;

  const ext = safeExtension(file.name, "png");
  const path = `${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(CATALOG_PHOTOS_BUCKET)
    .upload(path, file, { contentType: file.type || "image/png" });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("catalog_item_photos")
    .insert({ catalog_item_id: id, storage_path: path, is_cover: isCover })
    .select("id, is_cover")
    .single();
  if (error) {
    await supabase.storage.from(CATALOG_PHOTOS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ photo: { id: data.id, url: catalogPhotoUrl(path), is_cover: data.is_cover } }, { status: 201 });
}
