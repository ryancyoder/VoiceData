import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

// Attach or detach a document from one agent. Detaching only removes the link;
// the document stays for whichever other agents it matters to.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { identity?: unknown; linked?: unknown };

  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  if (!identity) return NextResponse.json({ error: "identity is required" }, { status: 400 });

  if (body.linked === false) {
    const { error } = await supabase
      .from("agent_document_links")
      .delete()
      .eq("document_id", id)
      .eq("identity", identity);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, linked: false });
  }

  // A global document already applies to every agent; linking it to one would
  // imply it applies to that one in particular.
  const doc = await supabase.from("agent_documents").select("is_global").eq("id", id).maybeSingle();
  if (doc.error) return NextResponse.json({ error: doc.error.message }, { status: 500 });
  if (!doc.data) return NextResponse.json({ error: "No such document" }, { status: 404 });
  if ((doc.data as { is_global: boolean }).is_global) {
    return NextResponse.json({ error: "That document already applies to every agent" }, { status: 400 });
  }

  const { error } = await supabase
    .from("agent_document_links")
    .upsert({ document_id: Number(id), identity }, { onConflict: "document_id,identity" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, linked: true });
}
