# Agent Ops

A multi-agent system for Ricci's Landscape Management. **Agents never call each
other.** They coordinate only through Supabase rows: each agent polls, claims a
queue row addressed to it, does the work, marks it complete, and optionally
enqueues follow-up rows for other agents.

## What was already here

The coordination layer (applied 21 Aug 2026) — do not rebuild it:

| Kind | Names |
|---|---|
| Tables | `agent_registry`, `agent_queue`, `agent_log`, `crew_locations`, `neighborhoods`, plus the Human Action Inbox columns on `tasks` |
| Functions | `claim_agent_work`, `enqueue_agent_work`, `complete_agent_work`, `fail_agent_work`, `agent_heartbeat` |
| Views | `agent_ops_status`, `agent_queue_live`, `human_action_inbox`, `pending_pm_review`, `crew_current_positions`, `deal_timeline` |

## Agent identity: `agent_prompts`

Identity lives in the database, **not** in local `CLAUDE.md` files. Most work
happens from the mobile app, where there is no working directory — a session
becomes an agent by loading its `agent_prompts` row.

One row per agent:

| Field | Purpose |
|---|---|
| `identity` | Agent name. FK to `agent_registry.agent_name`, so a brief cannot name an agent nobody registered. |
| `mandate` | One or two sentences: what this agent exists to do. |
| `owned_resources` | `text[]` — what it may **write**. |
| `readonly_resources` | `text[]` — what it may read but never touch. |
| `run_loop` | The literal claim → work → complete sequence. |
| `escalation_rules` | When to write a Human Action Inbox item instead of proceeding. |
| `handoff_rules` | Which agents it may enqueue for, and the payload shape each expects. |
| `version`, `updated_by`, `change_note` | Bookkeeping, maintained by trigger and by the console. |

The briefs are deliberately thin. They are meant to be wrong at first and to
grow from real failures. The one thing that must be right from day one is
`owned_resources` / `readonly_resources` — those are what prevent damage.
`handoff_rules` matters more than it looks: if the scheduler doesn't know what a
well-formed request to the librarian is, you get garbage rows.

### Resource identifier convention

Resources are prefixed so a calendar can never be read as a table:

```
table:tasks
view:human_action_inbox
fn:enqueue_agent_work
calendar:Proposals
bucket:deal-photos
connector:Gmail
```

A parenthetical after the identifier narrows the grant to part of a table:

```
table:tasks (insert escalation rows only: created_by_agent = 'scheduler')
table:agent_registry (own row only: status, last_heartbeat_at)
```

An entry with no recognised prefix is treated as a free-text note and rendered
as one in the console — useful for a blanket rule like *"EVERY production table
is read-only to you."*

## History: `agent_prompt_versions`

An immutable snapshot of every state a brief has been in, current one included —
same idea as `voicemap_wiki_versions`, so a bad brief edit can be diffed and
rolled back.

Three triggers do the work, which means a brief edited straight over SQL from a
phone session gets history too, not just one edited through the console:

- `agent_prompts_bump_version` (BEFORE UPDATE) — bumps `version` and
  `updated_at`, but **only** when one of the six brief fields actually changed.
  A bookkeeping-only write does not burn a version.
- `agent_prompts_snapshot_insert` / `_update` (AFTER INSERT/UPDATE) — writes the
  new state into `agent_prompt_versions`.
- `agent_prompt_versions_no_edit` — the table is append-only. Rows cannot be
  updated or deleted except by cascade when the parent brief is deleted.

**Rolling back is an ordinary save of the old text.** Loading v2 over a v3 brief
produces v4 with v2's content; nothing is rewritten and nothing is lost.

## The seven agents

| Agent | Lane |
|---|---|
| `project-manager` | Orchestration. Reads everything, writes only its own tables, influences the others solely by enqueueing. Also reviews every human-action item's wording before it reaches Ryan. |
| `scheduler` | Calendar. Writes only to `Calendar`, `Home`, `Plaude`, `Calls`, `Proposals` — never a coworker's calendar. |
| `librarian` | Knowledge base / wiki. Abstract and conceptual material, brainstorming. |
| `correspondence-manager` | Email: relationship staleness and deal linkage. |
| `mobilization-manager` | Spatial awareness, crews, routing. |
| `master-estimator` | Estimates and proposals; catalog knowledge; recall of comparable past jobs. Expect it to be thin for a while. |
| `data-ingestor` | Scraping and extraction. Always stages before landing. |

Seeded by [`agent-ops-seed.sql`](./agent-ops-seed.sql), which is idempotent —
re-running it re-applies the briefs and files the previous state as a version.

## The console

`/agent-ops` — a tile per registered agent showing liveness and queue depth.
Tap through to `/agent-ops/[agent]` for the brief in editable fields; saving
writes the row and snapshots the previous version. Agents pick up changes on
their next session, with no redeploy.

Ryan should never be logging into Supabase to hand-edit these tables from his
phone. Every rule in this system needs to be editable from that screen.

`PUT /api/agent-ops/prompts/[agent]` saves a brief; `GET …?version=N` returns one
historical version for diffing or rollback. `identity` is not editable through
the API — it is the agent's name and the foreign key.

## Session handoff docs

There are many scattered prior Claude sessions whose content needs sorting under
the right agents. Each session should emit a handoff doc before closing, using
these headings **verbatim and in this order**, so the librarian can parse them
mechanically rather than by judgment:

```markdown
## Session purpose
## Decisions made
## Open threads
- each with an owner agent named
## Knowledge for the wiki
## Artifacts touched
- tables, files, anything changed
```

Routing, per the librarian's `handoff_rules`: knowledge → the wiki; decisions →
the decisions record; each open thread → an `agent_queue` row addressed to the
owner it names. A thread naming no owner, or one not in `agent_registry`, goes
to `project-manager` rather than being guessed at.

## Open questions — not decided

- **Where does past-job history live?** The librarian is the natural knowledge
  keeper, but that agent is meant to be the abstract/philosophical one. Either
  the librarian owns it and the estimator queries it, or the estimator owns its
  own archive. Unresolved — `master-estimator`'s `handoff_rules` carry a note
  saying not to build either side out until Ryan decides.
- **Agent health signals.** `agent_log` already captures enough to surface
  "scheduler failed three tasks in a row" or "this queue row has sat unclaimed
  two days". Deferred, not dropped.

## Not built yet

Deliberately stopped before the agent-specific features — the correspondence
staleness board and linkage feed, the mobilization map and morning near-miss
briefing, the estimator's conversational recall, the data-ingestor's `ingest_*`
staging tables, and the librarian's handoff-doc ingest routine. The briefs
describe them so the rules are already written down when they get built.
