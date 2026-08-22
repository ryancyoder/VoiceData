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

  const { error } = await supabase
    .from("agent_document_links")
    .upsert({ document_id: Number(id), identity }, { onConflict: "document_id,identity" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, linked: true });
}
