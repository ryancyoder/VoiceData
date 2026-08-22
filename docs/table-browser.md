# Table Browser (`/tables`)

A read-only viewer for every table the project's Supabase REST API exposes —
the "just let me look at the data" screen, without opening the Supabase
dashboard. Nothing in it writes: the API routes only ever `SELECT`.

## What it does

- Sidebar lists every table with its row count (counts load in the
  background, one `HEAD` request each, so the grid paints first).
- Grid pages through rows (25–200 at a time), sorts by clicking a column
  header (asc → desc → off), and shows each column's Postgres type, primary
  key, and foreign key in the header tooltip.
- Free-text search across the table's text columns; if the term is a uuid it
  also matches uuid columns exactly.
- Per-column filters (`=`, `≠`, `>`, `≥`, `<`, `≤`, contains, starts/ends
  with, in list, is null, is not null) behind the **Filter** button.
- **Columns** hides noisy columns; **⤓** exports the current page as CSV.
- Clicking a row opens a detail panel with every column in full (jsonb and
  arrays pretty-printed) and a copy-as-JSON button. A foreign key in that
  panel is a link: it jumps to the referenced table filtered to that row.
- The selected table is kept in the URL (`/tables?table=deal_photos`), so a
  reload or a shared link lands in the same place.

## How the schema is discovered

Supabase doesn't expose `information_schema` over PostgREST, and this feature
deliberately adds nothing to the database — no migration, no RPC, no extra
grants. Instead `src/lib/tableBrowser.ts` fetches PostgREST's own OpenAPI
description from the REST root (`GET {SUPABASE_URL}/rest/v1/` with
`Accept: application/openapi+json`), which lists every table and view it
serves along with each column's Postgres type, nullability, default, and the
primary/foreign key notes PostgREST embeds in the column description. That's
the same metadata Supabase's API docs page is generated from. The result is
cached for a minute; the refresh button re-fetches it.

If that request ever fails, the page shows the status and body it got back
rather than an empty list — the likely causes are a bad
`NEXT_PUBLIC_SUPABASE_URL` or a key that can't read the schema.

## Access and safety

The routes (`/api/tables`, `/api/tables/counts`, `/api/tables/rows`) run
server-side with the service-role key, like the rest of the app, and sit
behind the password gate in `middleware.ts` (see `SECURITY_LOCKDOWN.md`).
Because the service role bypasses RLS, the browser shows every row — treat
`/tables` as an admin screen.

Requests are validated against the real schema before they run: an unknown
table or column is rejected, filter operators come from a fixed list, table
and column names are quoted for PostgREST (so names like `Sales Board`
work), and filter values containing `,` `(` `)` are quoted rather than
interpreted as syntax. Page size is capped at 200 rows.
