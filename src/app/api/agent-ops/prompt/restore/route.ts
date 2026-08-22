import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { AgentPrompt, AgentPromptVersion } from "@/lib/agentOps";

// Roll a brief back to an earlier version by copying that snapshot's fields
// back onto the live row. History is append-only, so a rollback moves the
// brief FORWARD to a new version whose content matches the old one — the bad
// edit stays in the record instead of being erased.
export const dynamic = "force-dynamic";

const PROMPT_COLS =
  "id, identity, mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules, version, updated_by, change_note, created_at, updated_at";

export async function POST(req: NextRequest) {
  let body: { identity?: string; version?: number; updated_by?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  const version = Number(body.version);
  if (!identity) return NextResponse.json({ error: "identity is required" }, { status: 400 });
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "version must be a positive integer" }, { status: 400 });
  }

  const snapshotRes = await supabase
    .from("agent_prompt_versions")
    .select("*")
    .eq("identity", identity)
    .eq("version", version)
    .maybeSingle();

  if (snapshotRes.error) return NextResponse.json({ error: snapshotRes.error.message }, { status: 500 });
  if (!snapshotRes.data) {
    return NextResponse.json({ error: `No version ${version} for "${identity}"` }, { status: 404 });
  }
  const snapshot = snapshotRes.data as AgentPromptVersion;

  const { data, error } = await supabase
    .from("agent_prompts")
    .update({
      mandate: snapshot.mandate,
      owned_resources: snapshot.owned_resources,
      readonly_resources: snapshot.readonly_resources,
      run_loop: snapshot.run_loop,
      escalation_rules: snapshot.escalation_rules,
      handoff_rules: snapshot.handoff_rules,
      change_note: `Rolled back to v${version}`,
      updated_by: body.updated_by?.trim() || "console",
    })
    .eq("identity", identity)
    .select(PROMPT_COLS)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `No brief for agent "${identity}"` }, { status: 404 });

  return NextResponse.json({ prompt: data as AgentPrompt });
}
