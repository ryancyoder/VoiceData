import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { AgentDocument } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    summary?: unknown;
    body?: unknown;
  };

  const update: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "A title is required" }, { status: 400 });
    update.title = title;
  }
  if (typeof body.summary === "string") update.summary = body.summary.trim();
  if (typeof body.body === "string") update.body = body.body;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }
  update.updated_by = "console";

  // The slug is left alone on rename: agents and links refer to a document by
  // it, and a title being tidied up should not break those.
  const { data, error } = await supabase
    .from("agent_documents")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No such document" }, { status: 404 });

  return NextResponse.json({ document: data as AgentDocument });
}

// Deletes the document everywhere, not just from this agent — detaching is the
// link route below. Its links go with it via the foreign key's cascade.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { error } = await supabase.from("agent_documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
