import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { getAgentPrompt, getPromptVersion } from "@/lib/agentOps";

// Read one historical version of a brief, or save a new state of it. Same
// origin, so it rides the app's password-gate cookie — no extra auth here.
//
// Versioning is NOT done in here on purpose: agent_prompts has triggers that
// bump the version and snapshot the row on every real change, so a brief edited
// straight over SQL from a phone session gets history too, not just one edited
// through this console.
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ agent: string }> };

interface BriefBody {
  mandate?: unknown;
  owned_resources?: unknown;
  readonly_resources?: unknown;
  run_loop?: unknown;
  escalation_rules?: unknown;
  handoff_rules?: unknown;
  change_note?: unknown;
}

function asText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function asStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return (value as string[]).map((v) => v.trim()).filter(Boolean);
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { agent } = await params;
  const identity = decodeURIComponent(agent);
  const versionParam = req.nextUrl.searchParams.get("version");

  const prompt = await getAgentPrompt(identity);
  if (!prompt) return NextResponse.json({ error: `No brief for "${identity}"` }, { status: 404 });

  if (!versionParam) return NextResponse.json(prompt);

  const version = Number(versionParam);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "version must be a positive integer" }, { status: 400 });
  }

  const snapshot = await getPromptVersion(prompt.id, version);
  if (!snapshot) return NextResponse.json({ error: `No v${version} for "${identity}"` }, { status: 404 });
  return NextResponse.json(snapshot);
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { agent } = await params;
  const identity = decodeURIComponent(agent);

  let body: BriefBody;
  try {
    body = (await req.json()) as BriefBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let fields;
  try {
    fields = {
      mandate: asText(body.mandate, "mandate"),
      owned_resources: asStringList(body.owned_resources, "owned_resources"),
      readonly_resources: asStringList(body.readonly_resources, "readonly_resources"),
      run_loop: asText(body.run_loop, "run_loop"),
      escalation_rules: asText(body.escalation_rules, "escalation_rules"),
      handoff_rules: asText(body.handoff_rules, "handoff_rules"),
      change_note:
        typeof body.change_note === "string" && body.change_note.trim() ? body.change_note.trim() : null,
      updated_by: "agent-ops console",
    };
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // identity is never editable here: it is the agent's name, the foreign key
  // into agent_registry, and what a mobile session looks itself up by.
  const existing = await getAgentPrompt(identity);

  if (!existing) {
    const { data, error } = await supabase
      .from("agent_prompts")
      .insert({ identity, ...fields })
      .select()
      .single();
    if (error) {
      // The FK is the guard against inventing an agent that no one registered.
      const status = error.code === "23503" ? 400 : 500;
      const message =
        error.code === "23503"
          ? `"${identity}" is not in agent_registry — register the agent before writing its brief`
          : error.message;
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from("agent_prompts")
    .update(fields)
    .eq("identity", identity)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
