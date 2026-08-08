import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { PP_LIBRARY_BUCKET, type LibraryItemData } from "@/lib/design/library";

type RouteParams = { params: Promise<{ id: string }> };

// Update a library item's metadata (rename / plant meta / default scale). Only
// the `data` jsonb changes here — the image is immutable for a given id.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  let body: { data?: LibraryItemData };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.data || typeof body.data !== "object") {
    return NextResponse.json({ error: "data object is required" }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from("pp_library_items")
    .update({ data: body.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

// Delete a library item and its Storage image.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: row, error: fetchErr } = await supabase
    .from("pp_library_items")
    .select("image_path")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const { error: delErr } = await supabase.from("pp_library_items").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Best-effort image cleanup; the row is already gone.
  if (row?.image_path) {
    await supabase.storage.from(PP_LIBRARY_BUCKET).remove([row.image_path as string]);
  }

  return NextResponse.json({ ok: true });
}
