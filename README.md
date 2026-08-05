# VoiceData

Talk to an AI to build out a database on the fly. Speak (or type) what you
want to track — "create a contacts table with name, phone, and email", "add
Dune by Frank Herbert to my reading list" — and the assistant creates tables,
adds columns, and inserts/updates/deletes rows in a local SQLite database as
you go.

## How it works

- **Voice input**: the browser records audio (`MediaRecorder`) and sends it
  to `/api/transcribe`, which calls the OpenAI Whisper API for speech-to-text.
- **Agent**: `/api/chat` sends the conversation to Claude (Anthropic) with a
  set of tools (`create_table`, `add_column`, `insert_row`, `query_rows`,
  etc.). Claude decides which tools to call based on what you said.
- **Database**: tool calls run against a local SQLite database
  (`data/voicedata.sqlite3`, created automatically) via `better-sqlite3`.
  Table/column names are validated before being used in DDL to avoid SQL
  injection.
- **Voice output**: the assistant's reply is spoken back using the browser's
  built-in `speechSynthesis` API — no extra API calls needed.
- **Sales Board** (`/sales-board`): a Kanban-style deal pipeline backed by a
  Supabase Postgres table, separate from the voice-driven SQLite database.
  Deals move through `Lead → Propose → Sent → Sold → Scheduled → Project
  Management → Job Costing → Invoiced → Paid in Full`.
- **Photo Gallery** (`/photos`): album-style browsing of every photo uploaded
  to a deal — one cover per deal, click through to that deal's full photo
  grid, with a lightbox for viewing/deleting individual photos.
- **Calendar** (`/calendar`): a week-view, hour-by-hour calendar of "events"
  inferred from photo metadata. Photos are geotagged (GPS) and timestamped
  from their EXIF data at upload time; photos taken at the same location
  with no gap longer than an hour between them are grouped into one event
  block. Click a block to see its photos and jump to the deal.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

- `ANTHROPIC_API_KEY` — powers the conversational agent
- `OPENAI_API_KEY` — powers Whisper transcription
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase
  project used by the Sales Board

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click the mic button,
speak, and watch the "Database" panel update as tables and data are created.
A text box is also available as a fallback if you'd rather type.

## Project layout

- `src/lib/db.ts` — dynamic SQLite layer (create/alter tables, CRUD on rows)
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
- `src/app/calendar/page.tsx` — Calendar, week view of photo-derived events
