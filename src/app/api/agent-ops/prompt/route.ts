import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { EDITABLE_FIELDS, isListField, type AgentPrompt, type EditableField } from "@/lib/agentOps";

// Save one agent's brief from the Agent Ops console. Same-origin, so it rides
// the app's password-gate cookie — no extra auth here.
//
// version, updated_at and the agent_prompt_versions snapshot are all produced
// by database triggers, so they are deliberately NOT accepted from the client:
// a save that changes no brief content does not bump the version or write a
// snapshot, and history can never be forged from here.
export const dynamic = "force-dynamic";

const PROMPT_COLS =
  "id, identity, mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules, version, updated_by, change_note, created_at, updated_at";

interface UpdatePayload {
  mandate?: string;
  owned_resources?: string[];
  readonly_resources?: string[];
  run_loop?: string;
  escalation_rules?: string;
  handoff_rules?: string;
  updated_by?: string | null;
  change_note?: string | null;
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  if (!identity) return NextResponse.json({ error: "identity is required" }, { status: 400 });

  const update: UpdatePayload = {};
  for (const field of EDITABLE_FIELDS) {
    const value = body[field];
    if (value === undefined) continue; // omitted field = leave it alone
    if (isListField(field)) {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        return NextResponse.json({ error: `${field} must be an array of strings` }, { status: 400 });
      }
      const list = (value as string[]).map((entry) => entry.trim()).filter(Boolean);
      (update as Record<EditableField, unknown>)[field] = list;
    } else {
      if (typeof value !== "string") {
        return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
      }
      (update as Record<EditableField, unknown>)[field] = value;
    }
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "No brief fields to update" }, { status: 400 });
  }

  const changeNote = typeof body.change_note === "string" ? body.change_note.trim() : "";
  update.change_note = changeNote || null;
  update.updated_by = typeof body.updated_by === "string" && body.updated_by.trim() ? body.updated_by.trim() : "console";

  const { data, error } = await supabase
    .from("agent_prompts")
    .update(update)
    .eq("identity", identity)
    .select(PROMPT_COLS)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `No brief for agent "${identity}"` }, { status: 404 });

  return NextResponse.json({ prompt: data as AgentPrompt });
}

// Create the missing brief for an agent that is registered but has none, so a
// gap can be closed from the phone instead of from the Supabase table editor.
// The identity FK means an unregistered name is rejected by the database.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  if (!identity) return NextResponse.json({ error: "identity is required" }, { status: 400 });

  const insert: Record<string, unknown> = {
    identity,
    updated_by: typeof body.updated_by === "string" && body.updated_by.trim() ? body.updated_by.trim() : "console",
    change_note: typeof body.change_note === "string" && body.change_note.trim() ? body.change_note.trim() : null,
  };
  for (const field of EDITABLE_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (isListField(field)) {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        return NextResponse.json({ error: `${field} must be an array of strings` }, { status: 400 });
      }
      insert[field] = (value as string[]).map((entry) => entry.trim()).filter(Boolean);
    } else {
      if (typeof value !== "string") {
        return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
      }
      insert[field] = value;
    }
  }

  const { data, error } = await supabase.from("agent_prompts").insert(insert).select(PROMPT_COLS).single();

  if (error) {
    // 23503 = FK violation: no agent_registry row behind this name.
    const status = error.code === "23503" ? 400 : error.code === "23505" ? 409 : 500;
    const message =
      error.code === "23503"
        ? `"${identity}" is not in agent_registry — register the agent before writing its brief`
        : error.code === "23505"
          ? `"${identity}" already has a brief`
          : error.message;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ prompt: data as AgentPrompt });
}
