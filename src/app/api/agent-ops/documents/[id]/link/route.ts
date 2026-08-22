import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

// Attach or detach a document from one agent, or from one app. Detaching only
// removes that link; the document stays for whatever else it belongs to.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    identity?: unknown;
    app_id?: unknown;
    linked?: unknown;
  };

  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  const appId = Number(body.app_id);
  const hasApp = Number.isInteger(appId) && appId > 0;
  if (!identity && !hasApp) {
    return NextResponse.json({ error: "identity or app_id is required" }, { status: 400 });
  }

  const table = hasApp ? "app_documents" : "agent_document_links";
  const keyColumn = hasApp ? "app_id" : "identity";
  const keyValue: string | number = hasApp ? appId : identity;

  if (body.linked === false) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("document_id", id)
      .eq(keyColumn, keyValue);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, linked: false });
  }

  // A global document already applies to every agent; linking it to one would
  // imply it applies to that one in particular. An app is a different axis, so
  // the check only applies to agent links.
  if (!hasApp) {
    const doc = await supabase.from("agent_documents").select("is_global").eq("id", id).maybeSingle();
    if (doc.error) return NextResponse.json({ error: doc.error.message }, { status: 500 });
    if (!doc.data) return NextResponse.json({ error: "No such document" }, { status: 404 });
    if ((doc.data as { is_global: boolean }).is_global) {
      return NextResponse.json({ error: "That document already applies to every agent" }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from(table)
    .upsert(
      { document_id: Number(id), [keyColumn]: keyValue },
      { onConflict: hasApp ? "app_id,document_id" : "document_id,identity" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, linked: true });
}
