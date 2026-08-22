import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { linesToArray } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ identity: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { identity } = await params;
  const { data, error } = await supabase
    .from("agent_prompts")
    .select("*")
    .eq("identity", identity)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `No brief for ${identity}` }, { status: 404 });
  return NextResponse.json({ prompt: data });
}

// Save the brief. The version bump and the snapshot into agent_prompt_versions
// are the database's job (triggers), so they happen whatever the write path —
// this route only has to send clean values.
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { identity } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const text = (value: unknown): string | undefined => (typeof value === "string" ? value.trim() : undefined);

  // Arrays arrive as one-per-line text from the editor, or already split.
  const list = (value: unknown): string[] | undefined => {
    if (typeof value === "string") return linesToArray(value);
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
    return undefined;
  };

  const update: Record<string, unknown> = {};
  for (const field of ["mandate", "run_loop", "escalation_rules", "handoff_rules"] as const) {
    const value = text(body[field]);
    if (value !== undefined) update[field] = value;
  }
  for (const field of ["owned_resources", "readonly_resources"] as const) {
    const value = list(body[field]);
    if (value !== undefined) update[field] = value;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  update.updated_by = text(body.updated_by) || "console";
  update.change_note = text(body.change_note) || null;

  const { data, error } = await supabase
    .from("agent_prompts")
    .update(update)
    .eq("identity", identity)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `No brief for ${identity}` }, { status: 404 });

  return NextResponse.json({ prompt: data });
}
