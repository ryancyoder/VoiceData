# VoiceData

Talk to an AI to build out a database on the fly. Speak (or type) what you
want to track — "create a contacts table with name, phone, and email", "add
Dune by Frank Herbert to my reading list" — and the assistant creates tables,
adds columns, and inserts/updates/deletes rows in a Supabase Postgres database
as you go.

## How it works

- **Voice input**: the browser records audio (`MediaRecorder`) and sends it
  to `/api/transcribe`, which calls the OpenAI Whisper API for speech-to-text.
- **Agent**: `/api/chat` sends the conversation to Claude (Anthropic) with a
  set of tools (`create_table`, `add_column`, `insert_row`, `query_rows`,
  etc.). Claude decides which tools to call based on what you said.
- **Database**: tool calls run server-side against Supabase Postgres. The
  user's dynamic tables are modeled as data inside two fixed tables
  (`voicedata_tables` + `voicedata_rows`), so no live DDL is needed and writes
  persist on the serverless deploy. Access is server-only via the service-role
  key; both tables have RLS enabled with no anon policy (deny-all), matching the
  lockdown in `SECURITY_LOCKDOWN.md`. Table/column names are still validated.
- **Voice output**: the assistant's reply is spoken back using the browser's
  built-in `speechSynthesis` API — no extra API calls needed.
- **Sales Board** (`/sales-board`): a Kanban-style deal pipeline backed by a
  Supabase Postgres table, separate from the voice-driven tables.
  Deals move through `Lead → Propose → Sent → Sold → Project
  Management → Invoiced → Paid in Full`. Each deal can also
  carry an all-day scheduled work window (`start_date` / `end_date`). Deals sharing the
  same jobsite address are linked to one `properties` row (repeat
  customers, multiple jobs at the same property over time), and a deal's
  detail view lists the other deals attached to its property.
- **Photo Gallery** (`/photos`): album-style browsing of every photo uploaded
  to a deal — one cover per deal, click through to that deal's full photo
  grid, with a lightbox for viewing/deleting individual photos.
- **Calendar** (`/calendar`): a week-view, hour-by-hour calendar of "events"
  inferred from photo metadata. Photos are geotagged (GPS) and timestamped
  from their EXIF data at upload time; photos taken at the same location
  with no gap longer than an hour between them are grouped into one event
  block. Click a block to see its photos and jump to the deal. A "+ Add
  Photo" button lets you upload straight from the calendar — the photo's
  GPS is matched against each deal's geocoded jobsite address (or, failing
  that, the location of that deal's other photos) to suggest which deal it
  belongs to, which you confirm or override before it uploads.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

- `ANTHROPIC_API_KEY` — powers the conversational agent
- `OPENAI_API_KEY` — powers Whisper transcription
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project
- `SUPABASE_SERVICE_ROLE_KEY` — server-only key the app uses to read/write
  Supabase (the voice database and everything else) once RLS is locked down;
  never prefix with `NEXT_PUBLIC`. See `.env.example` and `SECURITY_LOCKDOWN.md`.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click the mic button,
speak, and watch the "Database" panel update as tables and data are created.
A text box is also available as a fallback if you'd rather type.

## Project layout

- `src/lib/db.ts` — dynamic table layer over Supabase (create/alter tables, CRUD on rows)
- `src/lib/agent.ts` — Claude tool definitions and the tool-use loop
- `src/app/api/chat/route.ts` — conversation endpoint
- `src/app/api/transcribe/route.ts` — Whisper transcription endpoint
- `src/app/page.tsx` — voice UI (mic button, transcript, live schema panel)
- `src/lib/supabaseClient.ts` — Supabase client (Sales Board)
- `src/lib/salesBoard.ts` — Sales Board stage list and types
- `src/app/api/sales-board/` — REST endpoints for the Sales Board table
- `src/app/sales-board/page.tsx` — Sales Board Kanban UI
- `src/app/photos/page.tsx` — Photo Gallery (album view, filterable by deal)
- `src/lib/photoEvents.ts` — clusters geotagged photos into calendar events
  (same location + gaps no longer than an hour)
- `src/lib/geocode.ts` — geocodes jobsite addresses (Nominatim/OpenStreetMap,
  no API key required) and the haversine distance helper
- `src/lib/properties.ts` — finds or creates the `properties` row for a
  jobsite address (one property, many deals), geocoding once per unique
  address rather than redundantly per deal
- `src/app/calendar/page.tsx` — Calendar, week view of photo-derived events
- `src/app/calendar/PhotoUpload.tsx` — upload-from-calendar flow: reads GPS
  from the photo client-side, calls `/api/sales-board/match-location` to
  suggest a deal, then uploads via the existing per-deal photos endpoint
- `src/app/api/sales-board/match-location/route.ts` — ranks deals by
  distance from a given GPS point (via geocoded address or existing photo
  locations) for the upload-matching flow
- `/admin/geocode-backfill` — one-time utility to geocode jobsite
  addresses on deals that existed before automatic geocoding shipped;
  processes addresses in small batches (`src/app/api/sales-board/geocode-backfill/route.ts`)
  to respect Nominatim's ~1 request/second rate limit
