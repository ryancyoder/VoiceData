---
name: plaud-transcript-import
description: Import appointment recordings from Plaud (the Plaud MCP voice recorder) into the Sales Board as deal transcripts. Trigger whenever the user wants to pull Plaud recordings, match them to appointments/deals, or "add the transcript to the deal" — e.g. "do any Plaud recordings match my appointments", "import the transcript for the Marsh appointment", "save these recordings to the deals", or asks how appointment transcripts get into Supabase. Also covers parsing/cleaning a recording and splitting a recording that spans several appointments.
---

# Plaud appointment transcript import

Turn Plaud voice recordings of sales appointments into rows in the
Supabase `deal_transcripts` table, each linked to its deal and its
Appointment calendar event so it surfaces as a 📝 marker on the deal's
timeline in the Sales Board deal modal.

This is a **matching + parsing + insert** job, not a UI job. All of it runs
through two MCP servers: **Plaud** (`mcp__Plaud__*`) to read recordings, and
**Supabase** (`mcp__Supabase__*` / the project's Supabase MCP) to read events
and write transcripts. If either MCP is disconnected, say so and stop — there
is no local fallback.

Supabase project id: `ktgpjizfntdfpghalukx`.

## Data model

Table `public.deal_transcripts` (already exists):

| column | meaning |
|---|---|
| `id` | identity PK |
| `deal_id` | FK → `"Sales Board"(id)`, cascade. **Required.** |
| `event_id` | FK → `events(id)`, nullable. The Appointment event this came from (the "auto-link"). |
| `title` | short label, e.g. `Site visit — Marsh (storm damage cleanup)` |
| `transcript` | the cleaned transcript text (plus an optional `=== SUMMARY ===` block) |
| `recorded_at` | when the appointment happened (the event date), `timestamptz` |
| `created_at` | default `now()` |

An appointment is an `events` row with `event_type = 'Appointment'`. A deal
(`"Sales Board"`) has at most one Appointment event per visit; `events.deal_id`
links them. The deal modal reads `deal.transcripts` and renders each as a
collapsible entry + a 📝 dot/tile on the timeline, dated by `recorded_at`.

## Step 1 — Pull the appointment events

```sql
select e.id, e.name, e.start_time, e.deal_id, e.property_id,
       p.address, sb.deal_name, sb.proposal_description
from events e
left join properties p on p.id = e.property_id
left join "Sales Board" sb on sb.id = e.deal_id
where e.event_type = 'Appointment'
order by e.start_time desc;
```

`start_time` is stored in **UTC**. Note the deal name, address, and
`proposal_description` — they are how you confirm a match.

## Step 2 — List the Plaud recordings

`mcp__Plaud__list_files` with `date_from` / `date_to` around the appointment
window (dates are `YYYY-MM-DD`). Each file has `name`, `start_at`, `duration`
(ms), and `id`.

**Timezone:** Plaud `start_at` is **UTC**, same as `events.start_time`. The
date/time in a recording's *name* is **local** (Central; UTC−5 in summer CDT).
So `name "2026-08-18 12:14:07"` ↔ `start_at "2026-08-18T17:14:07Z"`. Match on
UTC-to-UTC.

## Step 3 — Match recordings to appointments

Rank candidates by, in order of trust:

1. **Name in the recording title** — "Consultation: Sean Rutkowski", "Brian
   Marsh - Storm Damage". A name match beats a time mismatch (appointments
   often run early/late/out of order vs. the scheduled slot).
2. **Time proximity** (UTC start_at vs. UTC start_time, same day).
3. **Content** — confirm against the deal's `proposal_description` /
   address once you read the transcript (e.g. Asbury's proposal was "House
   Landscape Total Restoration", which matched a fire-rebuild conversation).

Classify each as **strong** (name + time), **possible** (time only — verify by
content before saving), or **none**. Do not attach a possible match until the
content confirms it — a wrong attachment is worse than none.

## Step 4 — Pull the cleaned transcript

`mcp__Plaud__get_transcript` with `block: "transaction_polish"` (the AI-cleaned
transcript; per-utterance `{start_time, end_time, content, speaker}`).

- **Paginate** with `limit` ≈ 30–50 and the returned `next_cursor` until
  `next_cursor` is null. The cursor is base64 of `{"o":<offset>}`, so pages can
  be fetched in parallel by computing cursors (`{"o":30}`,`{"o":80}`,…).
- **The API is flaky.** `limit: 500` frequently 500s; 30–50 is reliable. On a
  500, retry with a smaller limit. `get_note` also 500s intermittently — retry.
- **Not every recording has a transcript.** If it returns "Block
  transaction_polish not available… Available blocks: mark_memo", there is no
  cleaned transcript to import — flag it to the user and skip (offer the memo
  instead).

### Cleaning / formatting

Assemble utterances into readable turns. Map the anonymous `Speaker N` to
roles by context (e.g. the one quoting prices = Estimator; the homeowner =
Client), and merge consecutive same-speaker lines. Trim pure backchannel.
**Trim non-appointment tails** — these recordings often continue past the visit
into the user's own AI/dev sessions, phone calls, driving (GPS + music), or
food orders. Include only the appointment itself.

## Step 5 — Split recordings that span several appointments

A single recording can cover a whole afternoon of back-to-back visits.
Boundaries are marked by:

- **GPS navigation** utterances ("Starting route to 5574 La Hayne Road") and
  **music/radio** during the drive — these divide one visit from the next, and
  name the next destination.
- **Greetings / voicemails** ("You Greg?", "Hi Fred, this is Ryan…").
- **Address cues** that map to a specific deal's property.

Split into one transcript per appointment and save each to its own deal,
verifying each block against that deal's address/`proposal_description`. If a
block is a client that isn't in the matched appointment list, leave it out and
mention it to the user. Note in the header that it was one recording split by
appointment.

## Step 6 — Insert (auto-linking the appointment)

Set `event_id` to the deal's Appointment event (Step 1) — that is the
auto-link. `recorded_at` = that event's date. Insert with Supabase
`execute_sql`, using **dollar-quoting** so you never have to escape the body:

```sql
insert into public.deal_transcripts (deal_id, event_id, title, recorded_at, transcript) values
(146, 129, 'Site visit — Marsh (storm damage cleanup)', '2026-08-18',
$plaud$[Auto-imported from Plaud recording "…", 2026-08-18. AI-cleaned transcript.]

=== SUMMARY ===
<optional 4-8 bullet summary>

=== TRANSCRIPT ===
Estimator: …
Client: …
$plaud$)
returning id, deal_id, event_id, title;
```

Use a dollar tag the body can't contain (`$plaud$`). If you must use ordinary
quotes instead, double every single quote (`''`). Prefix the body with a
provenance line naming the source recording and date. A `=== SUMMARY ===`
block on top is welcome when the user wants one.

**Idempotency:** before inserting, check the deal doesn't already have this
transcript, so a re-run doesn't duplicate:

```sql
select id, title, recorded_at from deal_transcripts where deal_id = 146;
```

To revise an existing row (e.g. to append the rest of a transcript once a
dropped Plaud connection is back), `update deal_transcripts set transcript = …
where id = <id>` rather than inserting again.

## Step 7 — Verify

```sql
select t.id, t.deal_id, sb.deal_name, t.event_id, e.event_type,
       t.title, t.recorded_at::date, length(t.transcript) as chars
from deal_transcripts t
join "Sales Board" sb on sb.id = t.deal_id
left join events e on e.id = t.event_id
order by t.id;
```

Confirm every row has the right `deal_name`, an `event_type = 'Appointment'`
link, and a plausible `chars` length. Then tell the user which appointments
were imported, which were skipped (no transcript / possible-only / not a
matched deal), and why.

## Gotchas checklist

- Plaud `start_at` = UTC; recording *name* time = local (UTC−5 CDT). Match UTC↔UTC.
- Recording titles beat scheduled times when they disagree.
- `limit: 500` 500s — use 30–50 and paginate; retry 500s smaller.
- Some recordings have only `mark_memo`, no `transaction_polish` — can't import a transcript.
- One recording can hold several appointments — split on GPS/music/greeting breaks.
- Trim AI-dev/phone-call/driving/food tails; keep only the visit.
- Confirm every match against `proposal_description`/address before saving.
- Dollar-quote the transcript body in SQL; check for an existing row first; `update` to revise.
