import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { renderAppBrief, type AgentDocument, type AgentPrompt, type App } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

const AGENT = "app-developer";

// The whole starting context for a session working on this app, as markdown.
// Built on request rather than with the page, so what gets copied is what the
// documents say now — not what they said when the tab was opened.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const appRes = await supabase.from("apps").select("*").eq("id", id).maybeSingle();
  if (appRes.error) return NextResponse.json({ error: appRes.error.message }, { status: 500 });
  const app = appRes.data as App | null;
  if (!app) return NextResponse.json({ error: "No such app" }, { status: 404 });

  const [promptRes, registryRes, docsRes, appLinkRes, agentLinkRes] = await Promise.all([
    supabase.from("agent_prompts").select("*").eq("identity", AGENT).maybeSingle(),
    supabase.from("agent_registry").select("role").eq("agent_name", AGENT).maybeSingle(),
    supabase.from("agent_documents").select("*").order("title"),
    supabase.from("app_documents").select("document_id").eq("app_id", app.id),
    supabase.from("agent_document_links").select("document_id").eq("identity", AGENT),
  ]);
  for (const res of [promptRes, registryRes, docsRes, appLinkRes, agentLinkRes]) {
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  }

  const documents = (docsRes.data ?? []) as AgentDocument[];
  const appIds = new Set(((appLinkRes.data ?? []) as { document_id: number }[]).map((l) => l.document_id));
  const agentIds = new Set(((agentLinkRes.data ?? []) as { document_id: number }[]).map((l) => l.document_id));

  const markdown = renderAppBrief({
    prompt: promptRes.data as AgentPrompt | null,
    role: (registryRes.data as { role: string } | null)?.role ?? null,
    app,
    appDocs: documents.filter((d) => appIds.has(d.id)),
    globalDocs: documents.filter((d) => d.is_global),
    agentDocs: documents.filter((d) => agentIds.has(d.id) && !d.is_global),
  });

  return NextResponse.json({ markdown, app: app.name });
}
