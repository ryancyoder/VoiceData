import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  LIST_FIELDS,
  PROMPT_COLUMNS,
  TEXT_FIELDS,
  VERSION_COLUMNS,
  type AgentPrompt,
  type AgentPromptVersion,
} from "@/lib/agentPrompts";

// Read and edit one agent's brief. The version snapshot is written by a database
// trigger, not here — so a brief edited from anywhere (this console, an agent,
// psql) still leaves a rollback point behind.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ identity: string }> }) {
  const { identity } = await ctx.params;

  const promptRes = await supabase
    .from("agent_prompts")
    .select(PROMPT_COLUMNS)
    .eq("identity", identity)
    .maybeSingle();
  if (promptRes.error) {
    return NextResponse.json({ error: promptRes.error.message }, { status: 500 });
  }
  if (!promptRes.data) {
    return NextResponse.json({ error: `No brief for "${identity}"` }, { status: 404 });
  }

  const versionsRes = await supabase
    .from("agent_prompt_versions")
    .select(VERSION_COLUMNS)
    .eq("prompt_id", (promptRes.data as unknown as AgentPrompt).id)
    .order("version", { ascending: false });
  if (versionsRes.error) {
    return NextResponse.json({ error: versionsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    prompt: promptRes.data as unknown as AgentPrompt,
    versions: (versionsRes.data ?? []) as unknown as AgentPromptVersion[],
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ identity: string }> }) {
  const { identity } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  for (const field of TEXT_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (typeof value !== "string") {
      return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
    }
    update[field] = value;
  }

  for (const field of LIST_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      return NextResponse.json({ error: `${field} must be an array of strings` }, { status: 400 });
    }
    const entries = (value as string[]).map((entry) => entry.trim()).filter(Boolean);
    // owned_resources is the field that prevents damage. Emptying it would leave
    // an agent with no writable surface at all — almost certainly a slip.
    if (field === "owned_resources" && entries.length === 0) {
      return NextResponse.json(
        { error: "owned_resources cannot be empty — an agent with no owned resources can do nothing" },
        { status: 400 }
      );
    }
    update[field] = entries;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // version and updated_at are derived by the bump trigger; a caller cannot set
  // them. change_note/updated_by ride along into the snapshot.
  const changeNote = typeof body.change_note === "string" ? body.change_note.trim() : "";
  update.change_note = changeNote || null;
  update.updated_by = typeof body.updated_by === "string" && body.updated_by.trim()
    ? body.updated_by.trim()
    : "agent-ops console";

  const saved = await supabase
    .from("agent_prompts")
    .update(update)
    .eq("identity", identity)
    .select(PROMPT_COLUMNS)
    .maybeSingle();
  if (saved.error) {
    return NextResponse.json({ error: saved.error.message }, { status: 500 });
  }
  if (!saved.data) {
    return NextResponse.json({ error: `No brief for "${identity}"` }, { status: 404 });
  }

  return NextResponse.json({ prompt: saved.data as unknown as AgentPrompt });
}
