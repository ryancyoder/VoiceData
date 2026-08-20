import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string; transcriptId: string }> };

// Edit a transcript's text, title, or recorded date. Only supplied fields
// change, so the client can patch one without restating the others.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { transcriptId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    transcript?: unknown;
    title?: unknown;
    recorded_at?: unknown;
  };

  const updates: Record<string, string | null> = {};
  if (body.transcript !== undefined) {
    if (typeof body.transcript !== "string" || !body.transcript.trim()) {
      return NextResponse.json({ error: "transcript can't be empty" }, { status: 400 });
    }
    updates.transcript = body.transcript.trim();
  }
  if (body.title !== undefined) {
    updates.title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
  }
  if (body.recorded_at !== undefined) {
    updates.recorded_at =
      typeof body.recorded_at === "string" && body.recorded_at.trim() ? body.recorded_at : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("deal_transcripts")
    .update(updates)
    .eq("id", transcriptId)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ transcript: data });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { transcriptId } = await params;
  const { error } = await supabase.from("deal_transcripts").delete().eq("id", transcriptId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
