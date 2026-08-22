import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ identity: string }> };

// Roll back to an earlier version by re-saving it onto the live row. The
// snapshot history is append-only, so a rollback is itself a new version —
// nothing in the record disappears when a bad edit is undone.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { identity } = await params;
  const body = (await req.json().catch(() => ({}))) as { version?: unknown };
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "version is required" }, { status: 400 });
  }

  const snapshot = await supabase
    .from("agent_prompt_versions")
    .select("mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules")
    .eq("identity", identity)
    .eq("version", version)
    .maybeSingle();
  if (snapshot.error) return NextResponse.json({ error: snapshot.error.message }, { status: 500 });
  if (!snapshot.data) {
    return NextResponse.json({ error: `No v${version} for ${identity}` }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("agent_prompts")
    .update({ ...snapshot.data, updated_by: "console", change_note: `Rolled back to v${version}` })
    .eq("identity", identity)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `No brief for ${identity}` }, { status: 404 });

  return NextResponse.json({ prompt: data });
}
