import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { AgentDocument } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

// Roll a document back by re-saving an old version onto it. The history stays
// append-only, so the rollback is itself a new version — same as the briefs.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { version?: unknown };
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "version is required" }, { status: 400 });
  }

  const snapshot = await supabase
    .from("agent_document_versions")
    .select("title, summary, body, is_global")
    .eq("document_id", id)
    .eq("version", version)
    .maybeSingle();
  if (snapshot.error) return NextResponse.json({ error: snapshot.error.message }, { status: 500 });
  if (!snapshot.data) return NextResponse.json({ error: `No v${version} of this document` }, { status: 404 });

  const { data, error } = await supabase
    .from("agent_documents")
    .update({ ...snapshot.data, updated_by: "console", change_note: `Rolled back to v${version}` })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No such document" }, { status: 404 });

  return NextResponse.json({ document: data as AgentDocument });
}
