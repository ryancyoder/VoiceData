# Agent Ops

A multi-agent system for Ricci's Landscape Management. Agents never call each
other. They coordinate only through Supabase rows: an agent polls, claims a
queue row addressed to it, does the work, marks it complete, and optionally
enqueues follow-up rows for other agents.

## The coordination layer (already applied, 21 Aug 2026)

| Object | What it is |
|---|---|
| `agent_registry` | The agents, their roles, and a liveness heartbeat |
| `agent_queue` | The bus. One row per durable agent-to-agent request |
| `agent_log` | Append-only shared history — how an agent learns what happened while it was not running |
| `crew_locations`, `neighborhoods` | Spatial observations and informal office place-names |
| `tasks.requires_human` / `human_instructions` / `instructions_reviewed_at` / `created_by_agent` | The Human Action Inbox |
| `claim_agent_work`, `enqueue_agent_work`, `complete_agent_work`, `fail_agent_work`, `agent_heartbeat` | The loop |
| `agent_ops_status`, `agent_queue_live`, `human_action_inbox`, `pending_pm_review`, `crew_current_positions`, `deal_timeline` | Views the console reads |

## The briefs

Agent identity lives in Supabase, not in a local `CLAUDE.md`. Most sessions
start from the phone, where there is no working directory — a session becomes
an agent by loading its `agent_prompts` row.

`agent_prompts`, one row per agent:

| Field | Purpose |
|---|---|
| `identity` | Agent name; matches `agent_registry.agent_name` |
| `mandate` | One or two sentences: what this agent exists to do |
| `owned_resources` | `text[]` — what it may **write** |
| `readonly_resources` | `text[]` — what it may read but never touch |
| `run_loop` | The literal claim → work → complete sequence |
| `escalation_rules` | When to write a Human Action Inbox item instead of proceeding |
| `handoff_rules` | Which agents it may enqueue for, and the payload shape each expects |
| `version`, `updated_by`, `change_note` | Written by the console and the triggers |

`agent_prompt_versions` holds an immutable snapshot of every version, current
one included, written by a trigger on `agent_prompts` — so the history covers
every write path, not just the console. The versions table is append-only
(`agent_prompt_versions_immutable`); a rollback is a new version rather than a
deletion.

The briefs are deliberately thin. They are meant to be wrong at first and to
grow from real failures. The exception is the two resource lists: those are the
guard rails, so they are exact from day one.

### The seven lanes

| Agent | Lane |
|---|---|
| `project-manager` | Orchestration. Reads everything, writes only `tasks`; influences other agents solely by enqueueing. Also reviews other agents' human-action wording before it reaches Ryan |
| `scheduler` | Calendar. Writes only `Calendar`, `Home`, `Plaude`, `Calls`, `Proposals` — never a coworker calendar |
| `librarian` | Knowledge base / wiki. Abstract and conceptual material, brainstorming |
| `correspondence-manager` | Email. A staleness board by relationship, plus a linkage feed that always shows *why* it linked |
| `mobilization-manager` | Spatial awareness, crews, routing. The near-miss check, delivered as one morning briefing |
| `master-estimator` | Estimates and proposals; memory of comparable past jobs. Thin for a while by design |
| `data-ingestor` | Scraping and extraction. Always stages a reviewable batch before landing anything |

## The console — `/agent-ops`

- **Tile list** — every registered agent with live queue counts (queued / in
  flight / failed), heartbeat age, and its brief version.
- **Detail view** — `/agent-ops/[identity]`. The brief in editable fields; the
  two array fields are edited one resource per line. Save writes the row; the
  database bumps the version and snapshots the previous state. Agents pick the
  change up on their next session — no redeploy.
- **Needs you** — the Human Action Inbox, at the top of the console: what the
  agents could not finish alone, each with the agent that raised it, the deal it
  belongs to, and a Done button. Items an agent raised but project-manager has
  not yet reworded are held back and shown separately, with a Release for when
  one should not wait (nothing runs project-manager on a schedule yet). Release
  sets only `instructions_reviewed_at` — `instructions_reviewed_by` is a foreign
  key to `agent_registry` and cannot name a person, and leaving it null is the
  honest record that no agent reviewed the wording.
- **History** — every version with its change note. Open one to see, field by
  field, what it said then versus now, and roll back if an edit was bad.
- **Copy brief** — the whole row as one markdown block, to paste into a mobile
  session that is becoming that agent.

Ryan should never be logging into Supabase to hand-edit these tables from his
phone. Every rule in the system is editable from this screen.

API: `GET /api/agent-ops`, `GET|PUT /api/agent-ops/[identity]`,
`POST /api/agent-ops/[identity]/restore`,
`POST /api/agent-ops/inbox/[taskId]/review`. Completing an inbox item goes
through the existing `PATCH /api/tasks/[id]`.

## Documents

Reference material the agents read — SOPs, formats, playbooks — lives in
`agent_documents` as markdown, for the same reason the briefs do: most sessions
start from the phone. `agent_document_links` maps documents to agents
many-to-many, so one format document can matter to the librarian and the
project-manager both.

Each agent page has a **Documents** section: the documents attached to that
agent, a rendered markdown viewer for the one you open, an editor, and a way to
attach a document another agent already uses. Detaching removes only that link
— the document stays for the other agents. Deleting removes it everywhere, and
its links go with it.

`updated_at` is maintained by a trigger rather than the app, so it stays right
whether the write came from the console, a SQL editor, or an agent through MCP.
A save that changes nothing does not move it.

API: `GET|POST /api/agent-ops/documents`,
`PUT|DELETE /api/agent-ops/documents/[id]`,
`POST /api/agent-ops/documents/[id]/link`.

## Session handoff format

Scattered Claude sessions each emit a handoff doc before closing, in this fixed
format, so the librarian can parse them mechanically rather than by judgment.
Same headings every time (see `docs/handoffs/`, and the "Session handoff
format" document attached to the librarian and project-manager):

```markdown
## Session purpose
## Decisions made
## Open threads
- each with an owner agent named
## Knowledge for the wiki
## Artifacts touched
- tables, files, anything changed
```

The librarian routine that ingests these — knowledge → wiki, decisions →
decisions table, open threads → `agent_queue` rows addressed to the owner — is
not built yet.

## Decided

- **Past-job history belongs to `master-estimator`** (Ryan, 22 Aug 2026). The
  estimator keeps the archive; other agents query it rather than filing job
  records elsewhere. The librarian keeps the general lesson a job teaches — that
  is a wiki page — and routes the record itself to the estimator. Both briefs
  say so. The archive table itself is not built yet: the estimator has ownership
  and, for now, nothing to write.

## Open questions — not decided

- **Agent health signals.** `agent_log` already captures enough to surface
  "scheduler failed three tasks in a row" or "this queue row has sat unclaimed
  two days." Deferred, not dropped.
