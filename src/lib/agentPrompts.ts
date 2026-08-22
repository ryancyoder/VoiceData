// Agent briefs live in Supabase, not in local CLAUDE.md files: most work happens
// from the mobile app, where there is no working directory. A session becomes an
// agent by loading its agent_prompts row.

export interface AgentPrompt {
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

export interface AgentPromptVersion {
  id: number;
  prompt_id: number;
  identity: string;
  version: number;
  mandate: string;
  owned_resources: string[];
  readonly_resources: string[];
  run_loop: string;
  escalation_rules: string;
  handoff_rules: string;
  updated_by: string | null;
  change_note: string | null;
  created_at: string;
}

// The editable brief, minus bookkeeping. Everything here is snapshotted on save.
export const TEXT_FIELDS = ["mandate", "run_loop", "escalation_rules", "handoff_rules"] as const;
export const LIST_FIELDS = ["owned_resources", "readonly_resources"] as const;

export type TextField = (typeof TEXT_FIELDS)[number];
export type ListField = (typeof LIST_FIELDS)[number];
export type BriefField = TextField | ListField;

export interface FieldSpec {
  key: BriefField;
  label: string;
  hint: string;
  kind: "text" | "list";
  rows: number;
}

// Order here is the order of the editor, and it is deliberate: what the agent is
// for, then what it may touch, then how it runs.
export const BRIEF_FIELDS: FieldSpec[] = [
  {
    key: "mandate",
    label: "Mandate",
    hint: "One or two sentences: what this agent exists to do.",
    kind: "text",
    rows: 4,
  },
  {
    key: "owned_resources",
    label: "Owned resources",
    hint: "Tables and calendars it may WRITE. One per line. This is the field that prevents damage — keep it exact.",
    kind: "list",
    rows: 7,
  },
  {
    key: "readonly_resources",
    label: "Read-only resources",
    hint: "What it may read but never touch. One per line.",
    kind: "list",
    rows: 6,
  },
  {
    key: "run_loop",
    label: "Run loop",
    hint: "The literal claim → work → complete sequence.",
    kind: "text",
    rows: 10,
  },
  {
    key: "escalation_rules",
    label: "Escalation rules",
    hint: "When to write a Human Action Inbox item instead of proceeding.",
    kind: "text",
    rows: 8,
  },
  {
    key: "handoff_rules",
    label: "Handoff rules",
    hint: "Which agents it may enqueue for, and the payload shape each expects. Vague here means garbage queue rows.",
    kind: "text",
    rows: 10,
  },
];

export const PROMPT_COLUMNS =
  "id, identity, mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules, version, updated_by, change_note, created_at, updated_at";

export const VERSION_COLUMNS =
  "id, prompt_id, identity, version, mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules, updated_by, change_note, created_at";

// A list field round-trips through a textarea as one entry per line. Blank lines
// are dropped so a stray newline never becomes an empty "resource".
export function listToText(values: string[] | null | undefined): string {
  return (values ?? []).join("\n");
}

export function textToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// Which brief fields differ between two states — drives the version diff.
export function changedFields(
  a: Pick<AgentPrompt, BriefField>,
  b: Pick<AgentPrompt, BriefField>
): BriefField[] {
  const changed: BriefField[] = [];
  for (const field of TEXT_FIELDS) {
    if ((a[field] ?? "") !== (b[field] ?? "")) changed.push(field);
  }
  for (const field of LIST_FIELDS) {
    if (listToText(a[field]) !== listToText(b[field])) changed.push(field);
  }
  return changed;
}

export function fieldLabel(key: BriefField): string {
  return BRIEF_FIELDS.find((f) => f.key === key)?.label ?? key;
}
