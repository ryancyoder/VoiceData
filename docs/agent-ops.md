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

### Adding an agent

**New agent** on the console takes a name, a role and an optional mandate, and
writes both rows — the `agent_registry` entry and its `agent_prompts` brief —
so a new agent always has something to load. If the brief fails to write, the
registry row is removed rather than leaving a registered agent with nothing
behind it.

Names are lowercase-kebab (`master-estimator`), because they appear in queue
rows, log rows and in SQL the agents write by hand.

A new agent starts with the standard run loop and escalation rules, and owns
nothing but `agent_log`, its own registry row, the queue functions, and
inserting escalation tasks. Its read-only list says so outright. It therefore
cannot touch anything until its lane is written — which is the safe direction
for a blank agent to fail in. Global documents reach it immediately, with no
linking.

## Documents

Reference material the agents read — SOPs, formats, playbooks — lives in
`agent_documents` as markdown, for the same reason the briefs do: most sessions
start from the phone. `agent_document_links` maps documents to agents
many-to-many, so one format document can matter to the librarian and the
project-manager both.

A document marked `is_global` applies to every agent instead of to the ones it
is linked to. It shows on every agent page under **Every agent**, and it carries
no links — going global drops the ones it had.

Each agent page shows **Documents** alongside the brief (stacked on a phone,
side by side from 1000px): what is attached to that agent, the global documents,
a rendered markdown viewer, an editor, and a way to attach a document another
agent already uses. Detaching removes only that link — the document stays for
the other agents. Deleting removes it everywhere, and its links go with it.

The console carries the **shared shelf**: the global documents, plus any
document filed under no agent at all, so nothing can go missing.

`agent_document_versions` snapshots every version the same way the briefs do —
by trigger on insert and on each content edit, append-only, with a rollback that
re-saves an old version as a new one. `updated_at` and `version` are derived by
the database, so they are right whether the write came from the console, a SQL
editor, or an agent through MCP, and a save that changes nothing does neither.

API: `GET|POST /api/agent-ops/documents`,
`PUT|DELETE /api/agent-ops/documents/[id]`,
`POST /api/agent-ops/documents/[id]/link`,
`GET /api/agent-ops/documents/[id]/versions`,
`POST /api/agent-ops/documents/[id]/restore`.

## Apps

`apps` holds every build and coding project — name, repo, live URL, status and a
summary. `app_documents` hangs documentation off an app, reusing
`agent_documents` rather than a second markdown store, so an app's docs get the
same versioning, history and rollback the briefs' documents have. A document can
belong to an app, to agents, or to both — they are separate axes.

Each app carries the icon a phone shows when its link is saved to the home
screen. **Fetch from site** looks for it the way a phone does — the
`apple-touch-icon` first, then the web manifest's icons (largest wins, skipping
maskable ones, which are padded for a circle mask), then a declared favicon,
then `/favicon.ico`. The image is stored on the row as a data URL rather than
kept as a remote link, so the icon survives the site moving or going behind
auth, and a list of eleven apps makes no third-party requests. An image URL can
be pasted instead. Until there is an icon, the app's initials stand in.

- `/agent-ops/apps` — the list, with a doc count per app and a New app form.
  Archived apps are folded away behind a count.
- `/agent-ops/apps/[slug]` — its documentation alongside its record (repo, live
  URL, status, summary). The slug does not change on rename, so a saved link
  keeps working.
- The **app-developer** page links to all of them; no other agent's page does.

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
