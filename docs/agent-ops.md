# Agent Ops

A multi-agent system for Ricci's Landscape Management. Agents never call each
other. They coordinate only through Supabase rows: each agent polls, claims a
queue row addressed to it, does the work, marks it complete, and optionally
enqueues follow-up rows for other agents.

## Where identity lives

In Supabase, not in a local `CLAUDE.md`. Most work happens from the mobile app,
where there is no working directory — so a session becomes an agent by loading
its `agent_prompts` row.

| Field | Purpose |
|---|---|
| `identity` | Agent name; FK to `agent_registry.agent_name` |
| `mandate` | One or two sentences: what this agent exists to do |
| `owned_resources` | `text[]` — tables/calendars it may **write** |
| `readonly_resources` | `text[]` — what it may read but never touch |
| `run_loop` | The literal claim → work → complete sequence |
| `escalation_rules` | When to write a Human Action Inbox item instead of proceeding |
| `handoff_rules` | Which agents it may enqueue for, and the payload shape expected |

Resource lines are prose with a reading-aid prefix — `table:`, `view:`, `rpc:`,
`calendar:`, `bucket:`. The brief is read by an agent, not enforced by the
database, so the lists have to be accurate: they are the only thing standing
between an agent and a table it should not be writing.

The briefs are otherwise thin on purpose. They are expected to be wrong at
first and to grow from real failures.

## History

`agent_prompt_versions` holds an immutable snapshot of every state a brief has
ever been in — written by trigger, on insert and on each edit (same pattern as
`voicemap_wiki_versions`). Two rules fall out of that:

- A save that changes no brief content does not bump the version or write a
  snapshot. Version numbers mean something.
- A rollback moves the brief *forward* to a new version whose content matches
  the old one. The bad edit stays in the record instead of being erased.

The versions table rejects UPDATE and stray DELETE. The one exception is a
DELETE that follows its parent prompt row out, so a retired agent can actually
be removed.

## The console — `/agent-ops`

One tile per agent: live status from `agent_ops_status` (heartbeat, queued, in
flight, failed) and the brief's current version. Tap a tile for the detail
screen: every brief field in an editable box, a "why this edit" note that is
kept with the snapshot, and the version history with a per-field diff and a
one-tap restore.

Edits are live on that agent's next session. Nothing redeploys, and nobody
should be logging into Supabase to hand-edit a table from a phone — every rule
in this system is meant to be editable from this screen.

API: `PUT /api/agent-ops/prompt` saves, `POST` creates a missing brief for a
registered agent, `POST /api/agent-ops/prompt/restore` rolls one back. All
same-origin, riding the app's password gate; `version`, `updated_at` and the
snapshot are produced by the database, never accepted from the client.

## The seven agents

| Agent | Lane |
|---|---|
| `project-manager` | Orchestration. Reads everything, writes only its own tables, influences the others solely by enqueueing. Also reviews human-action wording before it reaches Ryan. |
| `scheduler` | Calendar: `Calendar`, `Home`, `Plaude`, `Calls`, `Proposals`. Never a coworker calendar. |
| `librarian` | Knowledge base / wiki. Abstract and conceptual material, brainstorming. |
| `correspondence-manager` | Email. Staleness by relationship, and deal linkage with the reason shown. |
| `mobilization-manager` | Spatial awareness, crews, routing. Near-miss checks run as a morning briefing. |
| `master-estimator` | Estimates and proposals; memory of comparable past jobs. Thin for now — the estimates table holds a handful of rows. |
| `data-ingestor` | Scraping and extraction. Always stages before landing; nothing reaches a production table unapproved. |

## Not built yet

- The session-handoff ingest routine (knowledge → wiki, decisions → a decisions
  table that does not exist, open threads → `agent_queue`).
- Staging tables for `data-ingestor`. Until they exist, a staging request is an
  escalation, not a write.
- Agent health signals (`agent_log` already carries enough to surface "failed
  three in a row" or "unclaimed for two days").
- Where past-job history lives — librarian's archive or the estimator's own —
  is an open question, deliberately not decided here.
