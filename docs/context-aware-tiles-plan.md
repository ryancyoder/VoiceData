# Context-Aware Tiles → VoiceData Plan

**Goal:** A tile on the iPad is not a menu item — it is a *dynamic prompt
template*. Tapping it loads live variables out of Supabase and builds a system
prompt from them, so the conversation starts already knowing the client, the
job, and what past visits established. Talking fills the gaps; the gaps go back
into Supabase; the next tap starts further along.

Phases 1–2 are **built** (see §4). Phases 3–6 are the roadmap.

---

## 1. The core idea

Starting a conversation by explaining context out loud is the tax this removes.
The template isn't static text — it is assembled per tap from the deal's row,
its property, its contact, its history, and whatever earlier sessions recorded.

The sequencing that follows is *gap-driven*, not scripted: the assistant is told
what the database already knows and is forbidden from asking about it. Its whole
job is the remainder. That is what makes the loop compound — every visit ends
with fewer unknowns than it started with.

### Loose first, deterministic later

Sequencing starts conversational and only hardens once real usage shows which
questions get asked the same way every time. That is not a guess to be made up
front; it is a measurement, which is why the question log (§3.2) exists from day
one. A question asked in nearly every visit, worded the same way each time, has
earned a fixed column. One asked rarely, or phrased differently each time, has
not.

---

## 2. Where this sits in the existing app

The repo already had most of the ingredients; this feature is mostly wiring.

| Piece | Already existed | Used for |
|---|---|---|
| `TileLauncher` + Tile mode | ✅ `src/components/TileLauncher.tsx`, `src/lib/useTileMode.ts` | The Launch Pad the new tile is added to |
| Voice in | ✅ `MicButton` → `/api/transcribe` (Whisper) | Speaking a turn |
| Voice out | ✅ browser `speechSynthesis` | Replies read aloud |
| Tool-use loop | ✅ `src/lib/agent.ts` (SQLite voice DB) | The pattern the site-visit agent follows |
| Deal / property / contact model | ✅ `Sales Board` → `properties` → `contacts` | The context that gets loaded |
| Embeddings | ✅ `src/lib/embeddings.ts` (pgvector, gte-small via Edge Function) | Phase 5's similarity matching |
| Prompt-as-a-row | ✅ `agent_prompts` (Agent Ops) | The precedent Phase 6 generalizes |

A deal's contact and address are reached **only** by way of its property — never
stored on the deal. The context loader follows that rule rather than working
around it.

---

## 3. Schema

Applied to the project as migration `site_visit_sessions_phase_1_2`.

### 3.1 `site_visit_sessions`

One tile-launched, context-loaded conversation against a deal.

```sql
create table public.site_visit_sessions (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public."Sales Board"(id) on delete cascade,
  property_id bigint references public.properties(id) on delete set null,
  tile_key text not null default 'site-visit',
  status text not null default 'open' check (status in ('open', 'closed')),
  turns jsonb not null default '[]'::jsonb,
  summary text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index site_visit_sessions_one_open_per_deal
  on public.site_visit_sessions (deal_id) where status = 'open';
```

`tile_key` exists so Phase 3's extra tiles share this table rather than fork it.
The partial unique index is what makes re-tapping the tile **resume** rather
than fork a second live conversation about the same visit.

`turns` holds the dialog, deliberately *not* in `deal_transcripts` — those are
recorded-appointment transcripts (see the `plaud-transcript-import` skill), a
different kind of artifact from a structured agent dialog.

### 3.2 `site_visit_questions` — the log that decides what hardens

```sql
create table public.site_visit_questions (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.site_visit_sessions(id) on delete cascade,
  deal_id bigint not null references public."Sales Board"(id) on delete cascade,
  slug text not null,
  question text not null,   -- verbatim: phrasing drift is itself the signal
  answered boolean not null default false,
  answer text,
  asked_at timestamptz not null default now()
);
```

Storing the question **verbatim** is the point. Two numbers come out of it:

- **session share** — what fraction of all visits asked this at all.
- **distinct phrasings** — how settled the wording is.

High share + one phrasing ⇒ promote it to a real column. That report is served
by `GET /api/site-visit/questions` and rendered on the tile's own screen.

### 3.3 `site_visit_notes`

```sql
create table public.site_visit_notes (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.site_visit_sessions(id) on delete cascade,
  deal_id bigint not null references public."Sales Board"(id) on delete cascade,
  slug text,
  body text not null,
  created_at timestamptz not null default now()
);
```

Narration that no column covers — how the client seemed, what was noticed. This
is the subjective half of the pairing Phase 5 needs.

All three have RLS enabled with no policies, matching `SECURITY_LOCKDOWN.md`:
every table is reached only through server routes using the service-role key.

---

## 4. What Phases 1–2 ship

### Files

| Path | Role |
|---|---|
| `src/lib/siteVisit.ts` | Pure: the checklist, gap resolution, brief rendering. No database, so it is testable on its own. |
| `src/lib/siteVisitContext.ts` | Loads a deal's live context out of Supabase |
| `src/lib/siteVisitAgent.ts` | System prompt + the tool-use loop whose tools all write back |
| `src/lib/siteVisitSession.ts` | Session plumbing shared by the routes |
| `src/app/api/site-visit/route.ts` | Deal picker; start/resume a session |
| `src/app/api/site-visit/[id]/message/route.ts` | One spoken turn |
| `src/app/api/site-visit/[id]/close/route.ts` | Close out, write the summary |
| `src/app/api/site-visit/questions/route.ts` | The question-log report |
| `src/app/site-visit/` | The tile's UI: picker, live session, checklist |

### The checklist

Eleven items, each of which knows whether the database already answers it.
Six are **column-backed** (`scope`, `value`, `schedule`, `contact`,
`jobsite_address`, `next_action`) and write through to real columns. Five are
**log-backed** (`client_priorities`, `existing_issues`, `site_conditions`,
`access`, `constraints`) — no column exists for them yet, so answers live in the
question log until §3.2 says they have hardened. The UI marks these `log`.

A log-backed item answered on an earlier visit counts as **known** on the next
one. That is the compounding loop, and it works with no schema change at all.

### The turn cycle

Context is reloaded **before** each turn — so a gap answered a moment ago now
reads as known and the agent stops asking — and **again after**, so the returned
checklist reflects what that turn's tools just wrote. The model's history is
rebuilt from stored turn text only; tool_use blocks are dropped on purpose,
because the record of what those tools wrote comes back every turn as a freshly
resolved checklist. **The database is the memory; the transcript is just the
conversation.**

### What the agent may write

Deliberately narrow: descriptive and scheduling fields only
(`proposal_description`, `value`, `appointment_date`, `start_date`, `end_date`,
`rfp_date`), the property's primary contact, and one flagged next-action task.
Stage, status, and the money-in dates are moved on the board by a human, not by
something overheard in a driveway.

`record_answer` logs the question and answer but does **not** update the record;
its tool result names the follow-up tool still needed. One fact, two writes, and
the model is told so at the moment it matters.

---

## 5. Roadmap

**Phase 3 — Chaining and more tiles.** A "generate estimate" tile pre-loaded
from the visit that just closed. `tile_key` already distinguishes them. The
estimator (`/estimator`, `estimates` keyed one-per-deal) is the natural target.

**Phase 4 — Context-aware surfacing.** Time, day, season, and location reshuffle
the tile grid. The location half is largely solved already: properties are
geocoded and `/api/properties/match-location` ranks them by distance from a GPS
point. Tackle only once 1–3 have proven the plumbing.

**Phase 5 — Pattern matching and correlation.** Two distinct jobs:

- *Similar past jobs* — vector search over `site_visit_notes` and
  `deal_transcripts` via the existing pgvector setup. Embed on save, not in a
  batch: the whole value is having it on-site mid-estimate.
- *Narration vs. outcome* — pairing `site_visit_notes` (how it felt, client
  friction, delays) against margin and sales-per-hour. This is the piece nobody
  tracks by hand, and it needs a season of real data before it says anything.

**Phase 6 — Tiles as configuration.** Promote the tile/template pairing into its
own table, so a new tile is a row rather than a deploy. `agent_prompts` is the
working precedent in this same database, versioning included.

---

## 6. Retrieval architecture — where each approach fits

Three approaches, each suited to a different part of this system. They are not
competing choices; they answer different questions.

**Vector RAG (pgvector).** Matches text by feel, no manual tagging. Right for
the large pool of short, similarly-shaped narration this generates — job notes,
client interactions — where there is no hierarchy, just a need to find what is
conceptually similar. **Start here**; the infrastructure already exists.

**Graph traversal.** Explicit relationships — clients, jobs, materials,
suppliers, equipment, crew — for precise multi-hop questions ("every drainage
job over a certain size that used this specific gravel") that are clunky as a
similarity search. Costs maintenance that vector search does not: relationships
must be built deliberately, where embeddings fall out of narration for free.

**Vectorless RAG (PageIndex).** No embeddings; an LLM reasons down a
hierarchical table of contents at query time. Traceable reasoning, no awkward
chunking, but heavier per query. Right for long structured documents — the
Unilock guide, SOPs — and a separate track from job-narration matching.

### A graph layer without a migration

Add one edge table alongside the existing ones rather than replacing anything:

| edge_id | from_node | from_type | to_node | to_type | relationship |
|---|---|---|---|---|---|
| E1 | J101 | job | M20 | material | used_material |
| E2 | J101 | job | J102 | job | similar_to |
| E3 | M20 | material | S5 | supplier | sourced_from |

"Every drainage job that used pea gravel from supplier S7" walks
`jobs → job_edges → materials → job_edges → suppliers`. Postgres handles a few
hops fine with recursive CTEs. A dedicated graph database (Neo4j) only earns its
keep if traversals get deep or genuinely open-ended ("all jobs connected through
any chain of shared materials, regardless of hop count").

Worth noting this project already has the raw material for it: `materials`,
`equipment`, `assemblies`, `assembly_kit_items`, and `aspire_catalog` are all
present — the relationships are just not yet edges.

---

## 7. Beyond landscaping

The same narrate-and-cross-reference engine generalizes, and Phase 6 is what
makes each of these configuration rather than code:

- **Equipment/vehicles** — narrated post-job issues against maintenance logs, to
  predict failures before they strand a job. The `equipment` table already exists.
- **Personal wellness** — mood and energy against sleep, diet, exercise, to
  surface delayed cause-and-effect.
- **Daily task completion** — narrate the day; cross-reference open reminders and
  calendar events and mark things done, with no checklist to tick.
