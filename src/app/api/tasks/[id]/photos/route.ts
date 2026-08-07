import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { TASK_PHOTOS_BUCKET } from "@/lib/tasks";
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
    return NextResponse.json({ error: "Only images are supported" }, { status: 400 });
  }

  const ext = safeExtension(file.name, "jpg");
  const path = `task-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(TASK_PHOTOS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("task_photos")
    .insert({
      task_id: Number(id),
      storage_path: path,
      file_name: file.name || null,
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(TASK_PHOTOS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ photo: data }, { status: 201 });
}
