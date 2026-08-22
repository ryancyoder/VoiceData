import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { slugify, type AgentDocument } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

// Every document, each marked with whether it is linked to ?identity= — the
// agent page needs both its own documents and the ones it could attach.
export async function GET(req: NextRequest) {
  const identity = req.nextUrl.searchParams.get("identity");

  const [docsRes, linksRes] = await Promise.all([
    supabase.from("agent_documents").select("*").order("title"),
    identity
      ? supabase.from("agent_document_links").select("document_id").eq("identity", identity)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (docsRes.error) return NextResponse.json({ error: docsRes.error.message }, { status: 500 });
  if (linksRes.error) return NextResponse.json({ error: linksRes.error.message }, { status: 500 });

  const linked = new Set((linksRes.data ?? []).map((l) => (l as { document_id: number }).document_id));
  const documents = ((docsRes.data ?? []) as AgentDocument[]).map((d) => ({ ...d, linked: linked.has(d.id) }));

  return NextResponse.json({ documents });
}

// Create a document, optionally linking it to agents in the same request —
// a document made from an agent's page belongs to that agent straight away.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    summary?: unknown;
    body?: unknown;
    identities?: unknown;
  };

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "A title is required" }, { status: 400 });

  const insert = {
    slug: slugify(title),
    title,
    summary: typeof body.summary === "string" ? body.summary.trim() : "",
    body: typeof body.body === "string" ? body.body : "",
    updated_by: "console",
  };

  const { data, error } = await supabase.from("agent_documents").insert(insert).select().single();
  if (error) {
    const message = error.code === "23505" ? "A document with that title already exists" : error.message;
    return NextResponse.json({ error: message }, { status: error.code === "23505" ? 409 : 500 });
  }

  const identities = Array.isArray(body.identities)
    ? body.identities.filter((i): i is string => typeof i === "string" && i.trim() !== "")
    : [];
  if (identities.length > 0) {
    const linkRes = await supabase
      .from("agent_document_links")
      .insert(identities.map((identity) => ({ document_id: (data as AgentDocument).id, identity })));
    if (linkRes.error) return NextResponse.json({ error: linkRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ document: { ...(data as AgentDocument), linked: identities.length > 0 } }, { status: 201 });
}
