import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { safeExtension } from "@/lib/storagePaths";
import {
  PP_DESIGNS_BUCKET,
  ppDesignUrl,
  IMAGE_FIELD_COLUMNS,
  isImageField,
} from "@/lib/design/project";

type RouteParams = { params: Promise<{ id: string }> };

// Upload one image field (background / planImage / planSelection /
// planEraseMask / lightingPenMask / render) to the pp-designs bucket and record
// its path on the project row, replacing any previous object for that field.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  const field = form.get("field");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (typeof field !== "string" || !isImageField(field)) {
    return NextResponse.json({ error: "invalid image field" }, { status: 400 });
  }

  const column = IMAGE_FIELD_COLUMNS[field];

  try {
    // Old object for this field, so we can clean it up after a successful swap.
    const { data: existing } = await supabase
      .from("pp_projects")
      .select(column)
      .eq("id", id)
      .maybeSingle();
    const oldPath = existing ? ((existing as Record<string, unknown>)[column] as string | null) : null;

    const ext = safeExtension(file.name, "png");
    const path = `${id}/${field}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PP_DESIGNS_BUCKET)
      .upload(path, file, { contentType: file.type || "image/png" });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: row, error } = await supabase
      .from("pp_projects")
      .update({ [column]: path, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      await supabase.storage.from(PP_DESIGNS_BUCKET).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!row) {
      await supabase.storage.from(PP_DESIGNS_BUCKET).remove([path]);
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (oldPath && oldPath !== path) {
      await supabase.storage.from(PP_DESIGNS_BUCKET).remove([oldPath]);
    }

    return NextResponse.json({ path, url: ppDesignUrl(path) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload image" },
      { status: 500 }
    );
  }
}

// Clear one image field: remove the object and null the column.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const field = new URL(req.url).searchParams.get("field");
  if (!isImageField(field)) {
    return NextResponse.json({ error: "invalid image field" }, { status: 400 });
  }
  const column = IMAGE_FIELD_COLUMNS[field];

  const { data: existing } = await supabase
    .from("pp_projects")
    .select(column)
    .eq("id", id)
    .maybeSingle();
  const oldPath = existing ? ((existing as Record<string, unknown>)[column] as string | null) : null;

  const { error } = await supabase
    .from("pp_projects")
    .update({ [column]: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (oldPath) {
    await supabase.storage.from(PP_DESIGNS_BUCKET).remove([oldPath]);
  }

  return NextResponse.json({ ok: true });
}
