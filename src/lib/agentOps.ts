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

// Agent names are lowercase-kebab: they appear in queue rows, log rows and SQL
// the agents write by hand, so a name with a space or a capital in it is a
// quoting problem waiting to happen.
export function agentNameError(name: string): string | null {
  if (!name) return "A name is required";
  if (name.length < 3) return "Too short to be a name";
  if (name.length > 40) return "Keep it under 40 characters";
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
    return "Lowercase letters, numbers and hyphens only — like scheduler or master-estimator";
  }
  return null;
}

// A new agent starts with the same loop and escalation rules as everyone else,
// and owning nothing but its own bookkeeping. The lane is what you write next;
// until you do, it cannot touch anything.
export function starterBrief(identity: string): Pick<
  BriefFields,
  "owned_resources" | "readonly_resources" | "run_loop" | "escalation_rules"
> {
  return {
    owned_resources: [
      "table:agent_log",
      "fn:enqueue_agent_work",
      "table:agent_registry (own row only)",
      "table:tasks (insert escalation rows only: requires_human = true, created_by_agent = '" +
        identity +
        "', instructions_reviewed_at left null)",
    ],
    readonly_resources: [
      "NOTHING ELSE YET — until this list says otherwise, read what you need and write nothing outside the list above.",
    ],
    run_loop: `1. Claim work addressed to you:
     select * from claim_agent_work('${identity}', 5, 900);
   Claims up to 5 pending rows and leases them for 15 minutes. Rows you do not
   finish inside the lease are reaped and handed back to the queue.
2. Do the work — inside owned_resources only. If a row asks you to write
   something you do not own, do not do it: fail the row with that reason, or
   enqueue the agent that does own it.
3. Close every row you claimed:
     select complete_agent_work(<id>, '{"...":"..."}'::jsonb);   -- success
     select fail_agent_work(<id>, '<what went wrong>');          -- failure
   fail_agent_work retries up to max_attempts, then parks the row as failed.
4. Record what happened so the next session can pick up cold:
     insert into agent_log (agent_name, kind, summary, detail, deal_id, queue_id)
     values ('${identity}', '<kind>', '<one line>', '{}'::jsonb, <deal_id>, <queue_id>);
5. Enqueue follow-ups per your handoff rules:
     select enqueue_agent_work('${identity}', '<to_agent>', '<intent>',
       '{...}'::jsonb, <deal_id>, 100, now(), '<idempotency_key>');
6. Before you stop:
     select agent_heartbeat('${identity}', 'idle');

Never call another agent directly. A queue row is the only way to ask for
anything. Never claim a row addressed to someone else.`,
    escalation_rules: `Escalate instead of guessing. To put an item in front of Ryan:
  insert into tasks (title, deal_id, human_instructions, requires_human,
                     created_by_agent, source_queue_id)
  values ('<short title>', <deal_id or null>,
          '<what Ryan should do, in plain words>', true, '${identity}', <queue_id>);
project-manager reviews the wording before it reaches his Human Action Inbox,
so write it for him to read on a phone — not as a log line.

Escalate when:
- the work needs a write to something outside owned_resources
- the request is ambiguous and guessing wrong costs money, a client, or a day
- you would overwrite or delete something you did not create

This agent is new, so expect this list to be wrong. When it turns out to be,
the fix goes in the brief rather than in a conversation nobody will find again.`,
  };
}

// An app or coding project. app-developer owns these rows; documentation hangs
// off them through app_documents, reusing the same store the briefs' documents
// use so it gets the same versioning and history.
export interface App {
  id: number;
  slug: string;
  name: string;
  repo: string | null;
  live_url: string | null;
  status: AppStatus;
  summary: string;
  created_at: string;
  updated_at: string;
}

export type AppStatus = "active" | "paused" | "archived";
export const APP_STATUSES: AppStatus[] = ["active", "paused", "archived"];

export const repoUrl = (repo: string | null): string | null =>
  repo ? `https://github.com/${repo}` : null;
