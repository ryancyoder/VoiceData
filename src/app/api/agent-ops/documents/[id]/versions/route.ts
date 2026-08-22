import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { AgentDocumentVersion } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

// Fetched when history is opened rather than shipped with every page — a
// document with a long history would otherwise be paid for on every visit.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { data, error } = await supabase
    .from("agent_document_versions")
    .select("*")
    .eq("document_id", id)
    .order("version", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ versions: (data ?? []) as AgentDocumentVersion[] });
}
