// Agent Ops: the briefs that turn a session into an agent.
//
// Identity lives in Supabase (agent_prompts), not in a local CLAUDE.md — most
// work happens from the mobile app, where there is no working directory. A
// session becomes an agent by loading its row. Every edit here is picked up on
// the agent's next session; nothing redeploys.

/** A resource line is free text, but by convention it is prefixed:
 *  `table:`, `view:`, `rpc:`, `calendar:`, `bucket:`. The prefix is only a
 *  reading aid — the brief is prose an agent reads, not an ACL it enforces. */
export const RESOURCE_PREFIXES = ["table", "view", "rpc", "calendar", "bucket"] as const;

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

/** One row of agent_ops_status: registry state plus its queue backlog. */
export interface AgentOpsStatus {
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

/** The brief fields an edit can change. Version, timestamps and the snapshot
 *  are all derived in the database — the client never supplies them. */
export const EDITABLE_FIELDS = [
  "mandate",
  "owned_resources",
  "readonly_resources",
  "run_loop",
  "escalation_rules",
  "handoff_rules",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export type BriefDraft = Pick<AgentPrompt, EditableField>;

export const FIELD_LABELS: Record<EditableField, { label: string; hint: string }> = {
  mandate: {
    label: "Mandate",
    hint: "One or two sentences: what this agent exists to do.",
  },
  owned_resources: {
    label: "Owned resources — may write",
    hint: "One per line. The field that prevents damage: if it is not listed here, the agent does not write it.",
  },
  readonly_resources: {
    label: "Read-only resources — may read, never touch",
    hint: "One per line.",
  },
  run_loop: {
    label: "Run loop",
    hint: "The literal claim → work → complete sequence the agent follows.",
  },
  escalation_rules: {
    label: "Escalation rules",
    hint: "When to write a Human Action Inbox item instead of proceeding.",
  },
  handoff_rules: {
    label: "Handoff rules",
    hint: "Which agents this one may enqueue for, and the payload shape each expects. Vague here means garbage rows there.",
  },
};

export function isListField(field: EditableField): boolean {
  return field === "owned_resources" || field === "readonly_resources";
}

/** Resource arrays are edited as one-per-line text: a textarea beats a chip
 *  editor on a phone. Blank lines are dropped so a trailing newline is not
 *  stored as an empty resource. */
export function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listToLines(list: string[]): string {
  return list.join("\n");
}

export function draftFrom(prompt: Pick<AgentPrompt, EditableField>): BriefDraft {
  return {
    mandate: prompt.mandate,
    owned_resources: [...prompt.owned_resources],
    readonly_resources: [...prompt.readonly_resources],
    run_loop: prompt.run_loop,
    escalation_rules: prompt.escalation_rules,
    handoff_rules: prompt.handoff_rules,
  };
}

/** Same comparison the database's version-bump trigger makes: a save that
 *  changes nothing must not manufacture a version. */
export function draftsDiffer(a: BriefDraft, b: BriefDraft): boolean {
  return EDITABLE_FIELDS.some((field) =>
    isListField(field)
      ? listToLines(a[field] as string[]) !== listToLines(b[field] as string[])
      : a[field] !== b[field]
  );
}

/** Which fields differ between two briefs — drives the "changed: mandate,
 *  handoff rules" line on each entry in the version history. */
export function changedFields(a: BriefDraft, b: BriefDraft): EditableField[] {
  return EDITABLE_FIELDS.filter((field) =>
    isListField(field)
      ? listToLines(a[field] as string[]) !== listToLines(b[field] as string[])
      : a[field] !== b[field]
  );
}

export function fieldText(draft: BriefDraft, field: EditableField): string {
  const value = draft[field];
  return Array.isArray(value) ? listToLines(value) : value;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export type DiffOp = "same" | "add" | "remove";
export interface DiffLine {
  op: DiffOp;
  text: string;
}

/** Line-level diff (longest common subsequence) so a brief edit can be read at
 *  a glance: what a version changed, not just that it changed. Briefs are a
 *  few dozen lines, so the quadratic table is nothing. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "remove", text: a[i] });
      i++;
    } else {
      out.push({ op: "add", text: b[j] });
      j++;
    }
  }
  while (i < a.length) out.push({ op: "remove", text: a[i++] });
  while (j < b.length) out.push({ op: "add", text: b[j++] });
  return out;
}

/** Collapse long runs of unchanged lines so a one-line edit does not render
 *  the whole brief. Keeps `context` lines either side of every change. */
export function condenseDiff(lines: DiffLine[], context = 2): (DiffLine | { op: "gap"; count: number })[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.op === "same") return;
    for (let k = index - context; k <= index + context; k++) {
      if (k >= 0 && k < lines.length) keep.add(k);
    }
  });

  const out: (DiffLine | { op: "gap"; count: number })[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      if (skipped) {
        out.push({ op: "gap", count: skipped });
        skipped = 0;
      }
      out.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ op: "gap", count: skipped });
  return out;
}
