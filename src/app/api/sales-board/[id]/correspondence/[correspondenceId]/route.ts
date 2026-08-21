import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_CORRESPONDENCE_BUCKET } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string; correspondenceId: string }> };

// Edit a correspondence entry's note (body). Notes get corrected, so this is a
// plain update of the free-text field; a blank/empty note clears it to null.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { correspondenceId } = await params;
  const payload = (await req.json().catch(() => ({}))) as { body?: unknown };

  if (payload.body === undefined) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  if (payload.body !== null && typeof payload.body !== "string") {
    return NextResponse.json({ error: "body must be a string or null" }, { status: 400 });
  }
  const noteBody =
    typeof payload.body === "string" && payload.body.trim() ? payload.body.trim() : null;

  const { data, error } = await supabase
    .from("deal_correspondence")
    .update({ body: noteBody })
    .eq("id", correspondenceId)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ correspondence: data });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { correspondenceId } = await params;

  const { data: correspondence, error: fetchError } = await supabase
    .from("deal_correspondence")
    .select("storage_path")
    .eq("id", correspondenceId)
    .single();

  if (fetchError || !correspondence) {
    return NextResponse.json({ error: fetchError?.message || "Correspondence not found" }, { status: 404 });
  }

  const { error: deleteRowError } = await supabase.from("deal_correspondence").delete().eq("id", correspondenceId);
  if (deleteRowError) {
    return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  }

  // Channel touchpoints (call/email/text) have no file to remove.
  if (correspondence.storage_path) {
    await supabase.storage.from(DEAL_CORRESPONDENCE_BUCKET).remove([correspondence.storage_path]);
  }

  return NextResponse.json({ ok: true });
}
