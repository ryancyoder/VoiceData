import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { AgentStatus } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

// The console's tile list: every registered agent, its live queue counts, and
// whether it has a brief yet.
export async function GET() {
  const [statusRes, promptRes] = await Promise.all([
    supabase.from("agent_ops_status").select("*").order("agent_name"),
    supabase.from("agent_prompts").select("identity, version, updated_at, updated_by"),
  ]);
  if (statusRes.error) return NextResponse.json({ error: statusRes.error.message }, { status: 500 });
  if (promptRes.error) return NextResponse.json({ error: promptRes.error.message }, { status: 500 });

  return NextResponse.json({
    agents: (statusRes.data ?? []) as AgentStatus[],
    prompts: promptRes.data ?? [],
  });
}
