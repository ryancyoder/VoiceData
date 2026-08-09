import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { PLANT_IMAGES_BUCKET } from "@/lib/plants";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

function isOwnUpload(image: string | null | undefined): boolean {
  return !!image && !image.includes("/") && image.startsWith("combo-");
}

// POST /api/combinations/[id]/image — replace a combination's photo.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("plant_combinations")
    .select("image")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const prevImage = (existing.image as string | null) ?? null;

  const ext = safeExtension(file.name, "jpg");
  const filename = `combo-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PLANT_IMAGES_BUCKET)
    .upload(filename, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: row, error } = await supabase
    .from("plant_combinations")
    .update({ image: filename, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("image")
    .maybeSingle();
  if (error) {
    await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([filename]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (isOwnUpload(prevImage) && prevImage !== filename) {
    await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([prevImage as string]);
  }

  return NextResponse.json({ image: (row?.image as string | null) ?? filename });
}
