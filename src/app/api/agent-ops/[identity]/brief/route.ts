import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { renderAgentBrief, type AgentDocument, type AgentPrompt } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ identity: string }> };

// The starting context for a session becoming this agent: its brief, the rules
// every agent follows, and its own documents. Built on request, so what gets
// copied is what the documents say now.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { identity } = await params;

  const [promptRes, registryRes, docsRes, linkRes] = await Promise.all([
    supabase.from("agent_prompts").select("*").eq("identity", identity).maybeSingle(),
    supabase.from("agent_registry").select("role").eq("agent_name", identity).maybeSingle(),
    supabase.from("agent_documents").select("*").order("title"),
    supabase.from("agent_document_links").select("document_id").eq("identity", identity),
  ]);
  for (const res of [promptRes, registryRes, docsRes, linkRes]) {
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  }

  const prompt = promptRes.data as AgentPrompt | null;
  if (!prompt) return NextResponse.json({ error: `No brief for ${identity}` }, { status: 404 });

  const documents = (docsRes.data ?? []) as AgentDocument[];
  const mine = new Set(((linkRes.data ?? []) as { document_id: number }[]).map((l) => l.document_id));

  const markdown = renderAgentBrief({
    prompt,
    role: (registryRes.data as { role: string } | null)?.role ?? null,
    globalDocs: documents.filter((d) => d.is_global),
    agentDocs: documents.filter((d) => mine.has(d.id) && !d.is_global),
  });

  return NextResponse.json({ markdown });
}
