# Session handoff — Agent Ops: briefs + console

## Session purpose
Build the missing pieces of Agent Ops on top of the coordination layer applied
21 Aug: a home in Supabase for agent identity (`agent_prompts` +
`agent_prompt_versions`), thin briefs for seven agents, and a dashboard screen
where every rule in the system can be edited from a phone.

## Decisions made
- Agent identity lives in a Supabase row, not a local `CLAUDE.md`. A mobile
  session becomes an agent by loading its brief.
- Version snapshots are written by a database trigger, not by app code, so the
  history covers every write path — console, SQL editor, MCP.
- Rollback is implemented as a re-save of an old version rather than a delete.
  The versions table stays append-only, so an undo is itself part of the record.
- The two array fields (`owned_resources`, `readonly_resources`) are edited as
  one resource per line. It is the only array editor that works with a thumb.
- Briefs are thin on purpose; the resource lists are not. Those are the guard
  rails and were written exact from day one.
- Several sessions were building against this one Supabase project at the same
  time. This session adopted the schema and seeds another session had already
  applied instead of competing with them, and kept its own writes idempotent.

## Open threads
- **Where past-job history lives** — librarian's archive or the estimator's own.
  Owner: `project-manager` (needs Ryan's call before either agent builds it).
- **Agent health signals** from `agent_log` ("failed three in a row", "unclaimed
  two days"). Owner: `project-manager`. Deferred, not dropped.
- **A staging table for `data-ingestor`** — its brief says it may land nothing it
  has not staged, and there is nowhere to stage yet. Owner: `data-ingestor`.
- **The librarian's handoff-ingest routine** — parse these docs into wiki pages,
  decisions, and queue rows. Owner: `librarian`.
- **Agent-specific features** — correspondence staleness board, mobilization map
  and near-miss check, estimator recall. Owner: `project-manager`; all were held
  pending confirmation per the build order.

## Knowledge for the wiki
- Agents coordinate only through rows. An agent that calls another agent
  directly, or addresses a queue row to itself to get around its own lane, has
  broken the model.
- The guard rail that matters is `owned_resources`. Everything else in a brief
  can be sloppy and self-correct; that list cannot.
- The morning briefing is morning-only for a reason: a route can be changed at
  7am and not mid-appointment.
- `project-manager` reviewing human-action wording before it reaches Ryan is
  what keeps the Human Action Inbox readable.
- The estimator's value is memory of past jobs, not the catalog. It stays thin
  until the Aspire history is organized, and should say "I have no comparable"
  rather than invent one.

## Artifacts touched
- Supabase: `agent_registry` (added `master-estimator`, `data-ingestor`),
  `agent_prompts` and `agent_prompt_versions` (schema and seven seeded briefs
  were applied by a parallel session; this session's inserts were idempotent
  no-ops).
- Code: `src/lib/agentOps.ts`, `src/app/agent-ops/*`,
  `src/app/api/agent-ops/*`, `src/components/NavBar.tsx`,
  `src/components/TileLauncher.tsx`, `docs/agent-ops.md`.
