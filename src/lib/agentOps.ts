import { supabase } from "@/lib/supabaseClient";

// Agent Ops reads. Agent identity lives in Supabase rather than in local
// CLAUDE.md files: most work happens from the phone, where there is no working
// directory. A session becomes an agent by loading its agent_prompts row, so
// every rule in this system has to be editable from the console — never by
// hand-editing tables in the Supabase dashboard.

export interface AgentStatusRow {
  agent_name: string;
  role: string;
  status: string;
  last_heartbeat_at: string | null;
  last_run_at: string | null;
  stale: boolean;
  queued: number;
  in_flight: number;
  failed: number;
  done_24h: number;
  oldest_pending_at: string | null;
}

export interface AgentPromptRow {
  id: number;
  identity: string;
  mandate: string;
  owned_resources: string[];
  readonly_resources: string[];
  run_loop: string;
  escalation_rules: string;
  handoff_rules: string;
  version: number;
  updated_by: string | null;
  change_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentPromptVersionRow {
  id: number;
  version: number;
  change_note: string | null;
  updated_by: string | null;
  created_at: string;
}

// The editable half of a brief — what the console writes back and what the
// snapshot trigger versions. Everything else on the row is bookkeeping.
export const BRIEF_FIELDS = [
  "mandate",
  "owned_resources",
  "readonly_resources",
  "run_loop",
  "escalation_rules",
  "handoff_rules",
] as const;

export type BriefField = (typeof BRIEF_FIELDS)[number];

export interface AgentBriefDraft {
  mandate: string;
  owned_resources: string[];
  readonly_resources: string[];
  run_loop: string;
  escalation_rules: string;
  handoff_rules: string;
}

const PROMPT_COLS =
  "id, identity, mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules, version, updated_by, change_note, created_at, updated_at";

export async function listAgentStatus(): Promise<AgentStatusRow[]> {
  const { data, error } = await supabase.from("agent_ops_status").select("*").order("agent_name");
  if (error) throw new Error(`Failed to load agent status: ${error.message}`);
  return (data ?? []) as AgentStatusRow[];
}

export async function listAgentPrompts(): Promise<AgentPromptRow[]> {
  const { data, error } = await supabase.from("agent_prompts").select(PROMPT_COLS).order("identity");
  if (error) throw new Error(`Failed to load agent briefs: ${error.message}`);
  return (data ?? []) as AgentPromptRow[];
}

export async function getAgentPrompt(identity: string): Promise<AgentPromptRow | null> {
  const { data, error } = await supabase
    .from("agent_prompts")
    .select(PROMPT_COLS)
    .eq("identity", identity)
    .maybeSingle();
  if (error) throw new Error(`Failed to load ${identity}'s brief: ${error.message}`);
  return (data as AgentPromptRow | null) ?? null;
}

export async function getAgentStatus(identity: string): Promise<AgentStatusRow | null> {
  const { data, error } = await supabase
    .from("agent_ops_status")
    .select("*")
    .eq("agent_name", identity)
    .maybeSingle();
  if (error) throw new Error(`Failed to load ${identity}: ${error.message}`);
  return (data as AgentStatusRow | null) ?? null;
}

// Version history for the detail view. The snapshot trigger writes a row for
// every state the brief has been in, current one included, so this is the whole
// story of the brief — newest first.
export async function listPromptVersions(promptId: number, limit = 25): Promise<AgentPromptVersionRow[]> {
  const { data, error } = await supabase
    .from("agent_prompt_versions")
    .select("id, version, change_note, updated_by, created_at")
    .eq("prompt_id", promptId)
    .order("version", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load version history: ${error.message}`);
  return (data ?? []) as AgentPromptVersionRow[];
}

// One historical version in full, for diffing or rolling back. Rollback is a
// normal save of the old text — agent_prompt_versions is append-only.
export async function getPromptVersion(
  promptId: number,
  version: number
): Promise<(AgentBriefDraft & AgentPromptVersionRow) | null> {
  const { data, error } = await supabase
    .from("agent_prompt_versions")
    .select(
      "id, version, change_note, updated_by, created_at, mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules"
    )
    .eq("prompt_id", promptId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new Error(`Failed to load version ${version}: ${error.message}`);
  return (data as (AgentBriefDraft & AgentPromptVersionRow) | null) ?? null;
}

// Resource identifiers are prefixed so a calendar can never be read as a table.
// A parenthetical after the identifier narrows the grant to part of a table
// ("table:tasks (insert escalation rows only)").
export function resourceKind(resource: string): string {
  const prefix = resource.split(":", 1)[0];
  return ["table", "view", "fn", "calendar", "bucket", "connector"].includes(prefix) ? prefix : "note";
}

// Split "table:tasks (insert escalation rows only)" into its parts for display.
export function parseResource(resource: string): { kind: string; name: string; scope: string | null } {
  const kind = resourceKind(resource);
  const rest = kind === "note" ? resource : resource.slice(kind.length + 1);
  const match = rest.match(/^([^(]+?)\s*\(([\s\S]+)\)\s*$/);
  if (match) return { kind, name: match[1].trim(), scope: match[2].trim() };
  return { kind, name: rest.trim(), scope: null };
}

export function briefFrom(row: AgentPromptRow | (AgentBriefDraft & object)): AgentBriefDraft {
  return {
    mandate: row.mandate,
    owned_resources: row.owned_resources,
    readonly_resources: row.readonly_resources,
    run_loop: row.run_loop,
    escalation_rules: row.escalation_rules,
    handoff_rules: row.handoff_rules,
  };
}
