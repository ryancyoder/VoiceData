// Agent Ops: the briefs the agents run on.
//
// Agent identity lives in Supabase, not in a local CLAUDE.md — most sessions
// start from the phone, where there is no working directory. A session becomes
// an agent by loading its agent_prompts row, which is why every rule in it has
// to be editable from the console rather than from a SQL editor.

// The editable body of a brief. Everything else on the row (version, updated_at)
// is written by the database.
export interface BriefFields {
  mandate: string;
  owned_resources: string[];
  readonly_resources: string[];
  run_loop: string;
  escalation_rules: string;
  handoff_rules: string;
}

export interface AgentPrompt extends BriefFields {
  id: number;
  identity: string;
  version: number;
  updated_by: string | null;
  change_note: string | null;
  created_at: string;
  updated_at: string;
}

// A snapshot of the brief as it was at that version. Written by a trigger on
// agent_prompts, so the history covers every write path — console, SQL, MCP.
export interface AgentPromptVersion extends BriefFields {
  id: number;
  prompt_id: number;
  identity: string;
  version: number;
  updated_by: string | null;
  change_note: string | null;
  created_at: string;
}

// One tile on the console: the registry row plus its live queue counts, from
// the agent_ops_status view.
export interface AgentStatus {
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

export const BRIEF_FIELDS = [
  "mandate",
  "owned_resources",
  "readonly_resources",
  "run_loop",
  "escalation_rules",
  "handoff_rules",
] as const;

export const FIELD_LABELS: Record<keyof BriefFields, string> = {
  mandate: "Mandate",
  owned_resources: "Owned resources — may write",
  readonly_resources: "Read-only resources — never write",
  run_loop: "Run loop",
  escalation_rules: "Escalation rules",
  handoff_rules: "Handoff rules",
};

export const FIELD_HINTS: Record<keyof BriefFields, string> = {
  mandate: "One or two sentences: what this agent exists to do.",
  owned_resources:
    "One per line. The guard rail — if it is not on this list the agent may not write it, so keep it exact.",
  readonly_resources: "One per line. What it may read but must never touch.",
  run_loop: "The literal claim → work → complete sequence the agent follows.",
  escalation_rules: "When to write a Human Action Inbox item instead of proceeding.",
  handoff_rules:
    "Which agents it may enqueue for, and the payload each expects. Vague here is what produces garbage queue rows.",
};

// The text[] columns are edited as one-per-line text, which is the only array
// editor that works with a thumb on a phone.
export const linesToArray = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const arrayToLines = (values: string[] | null | undefined): string => (values ?? []).join("\n");

export function fieldsEqual(a: BriefFields, b: BriefFields): boolean {
  return (
    a.mandate === b.mandate &&
    a.run_loop === b.run_loop &&
    a.escalation_rules === b.escalation_rules &&
    a.handoff_rules === b.handoff_rules &&
    arrayToLines(a.owned_resources) === arrayToLines(b.owned_resources) &&
    arrayToLines(a.readonly_resources) === arrayToLines(b.readonly_resources)
  );
}

// The brief as one markdown block — what a mobile session pastes in to become
// this agent. Same content as the row; the headings are just for reading.
export function renderBrief(prompt: AgentPrompt, role?: string | null): string {
  const list = (values: string[]) =>
    values.length > 0 ? values.map((v) => `- ${v}`).join("\n") : "- (nothing listed)";

  return [
    `# ${prompt.identity}`,
    "",
    `_${role ?? ""}${role ? " — " : ""}brief v${prompt.version}, updated ${prompt.updated_at.slice(0, 10)}._`,
    "",
    "## Mandate",
    prompt.mandate,
    "",
    "## You may write to",
    list(prompt.owned_resources),
    "",
    "## Read-only — never write",
    list(prompt.readonly_resources),
    "",
    "Anything not on those two lists is outside your lane. Escalate instead of writing it.",
    "",
    "## Run loop",
    prompt.run_loop,
    "",
    "## Escalation",
    prompt.escalation_rules,
    "",
    "## Handoffs",
    prompt.handoff_rules,
    "",
  ].join("\n");
}

// An item an agent could not finish without Ryan, after project-manager has
// made the wording readable. Read from the human_action_inbox view.
export interface HumanActionItem {
  id: number;
  title: string;
  human_instructions: string | null;
  deal_id: number | null;
  deal_name: string | null;
  deal_value: number | null;
  start_date: string | null;
  created_by_agent: string | null;
  created_at: string;
}

// Raised by an agent but not yet reviewed, so it is deliberately held back
// from the inbox above. Read from the pending_pm_review view.
export interface PendingReviewItem {
  id: number;
  title: string;
  human_instructions: string | null;
  created_by_agent: string | null;
  created_at: string;
}

// A markdown reference document an agent reads — an SOP, a format, a playbook.
// Too long to live inside a brief, and kept in the database for the same reason
// the briefs are: most sessions start from the phone.
export interface AgentDocument {
  id: number;
  slug: string;
  title: string;
  summary: string;
  body: string;
  // Applies to every agent rather than only the ones it is linked to.
  is_global: boolean;
  version: number;
  updated_by: string | null;
  change_note: string | null;
  created_at: string;
  updated_at: string;
}

// A snapshot of a document at one version, written by a trigger on
// agent_documents — the same arrangement the briefs use.
export interface AgentDocumentVersion {
  id: number;
  document_id: number;
  slug: string;
  title: string;
  summary: string;
  body: string;
  is_global: boolean;
  version: number;
  updated_by: string | null;
  change_note: string | null;
  created_at: string;
}

// A document plus whether it is linked to the agent currently being viewed.
export interface AgentDocumentListing extends AgentDocument {
  linked: boolean;
}

// URL-safe, stable, and readable in a slug column. Falls back to a timestamp
// only if the title has nothing slug-able in it at all.
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `document-${Date.now()}`;
}
