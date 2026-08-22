import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { agentNameError, starterBrief } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

// Register a new agent and give it a starting brief in the same breath. An
// agent with a registry row but no brief has nothing to load at the start of a
// session, so the two are created together or not at all.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    agent_name?: unknown;
    role?: unknown;
    mandate?: unknown;
  };

  const agentName = typeof body.agent_name === "string" ? body.agent_name.trim().toLowerCase() : "";
  const nameError = agentNameError(agentName);
  if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

  const role = typeof body.role === "string" ? body.role.trim() : "";
  if (!role) return NextResponse.json({ error: "A role is required" }, { status: 400 });

  const registry = await supabase
    .from("agent_registry")
    .insert({ agent_name: agentName, role, note: "Created from the Agent Ops console." })
    .select()
    .single();
  if (registry.error) {
    const taken = registry.error.code === "23505";
    return NextResponse.json(
      { error: taken ? `There is already an agent called ${agentName}` : registry.error.message },
      { status: taken ? 409 : 500 }
    );
  }

  const starter = starterBrief(agentName);
  const prompt = await supabase
    .from("agent_prompts")
    .insert({
      identity: agentName,
      mandate: typeof body.mandate === "string" ? body.mandate.trim() : "",
      handoff_rules: "",
      updated_by: "console",
      change_note: "Created from the console. Lane still to be written.",
      ...starter,
    })
    .select()
    .single();

  // Don't leave a registered agent with no brief behind: undo the registry row
  // rather than half-create an agent that cannot load anything.
  if (prompt.error) {
    await supabase.from("agent_registry").delete().eq("agent_name", agentName);
    return NextResponse.json({ error: prompt.error.message }, { status: 500 });
  }

  return NextResponse.json({ agent: registry.data, prompt: prompt.data }, { status: 201 });
}
