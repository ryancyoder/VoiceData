# Table browser (`/db`)

A read-only view of the Supabase Postgres database behind the app: every table
and view in the `public` schema on the left, its rows on the right — sortable,
searchable, paginated, with a drawer showing one row in full.

It only reads. There is no insert, update or delete anywhere in the feature, and
the table and sort column named in a request are both checked against the real
schema before any query runs.

## How it gets the schema

PostgREST — what `@supabase/supabase-js` talks to — can serve rows but can't
list tables or describe columns. So the browser asks Postgres directly through
two read-only functions:

- `db_browser_schema()` → one jsonb array of tables/views with their columns
  (type, nullability, primary key, comment).
- `db_browser_counts()` → an exact `count(*)` per table. Split from the schema
  call because it's the slow half: the UI paints the table list first and fills
  the counts in when they land. (`reltuples` would have been free, but it reads
  `-1` for any table that has never been analyzed, which is most of them.)

Both are `SECURITY INVOKER` and granted to `service_role` **only** — `anon` and
`authenticated` get nothing, matching the lockdown in
[SECURITY_LOCKDOWN.md](../SECURITY_LOCKDOWN.md). The app reaches them from
server routes (`/api/db/*`) that sit behind the password gate and hold
`SUPABASE_SERVICE_ROLE_KEY`. Without that key set, the browser shows a setup
message instead of data.

## Installing the functions

Already applied to the project this app points at (migration
`db_browser_introspection_functions`). To set it up on another project, run this
in the Supabase SQL editor:

```sql
create or replace function public.db_browser_schema()
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'name', c.relname,
      'kind', case c.relkind
                when 'v' then 'view'
                when 'm' then 'materialized_view'
                else 'table'
              end,
      'comment', pg_catalog.obj_description(c.oid, 'pg_class'),
      'columns', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'nullable', not a.attnotnull,
          'is_primary_key', pk.attnum is not null,
          'comment', pg_catalog.col_description(a.attrelid, a.attnum)
        ) order by a.attnum), '[]'::jsonb)
        from pg_catalog.pg_attribute a
        left join lateral (
          select a.attnum
          from pg_catalog.pg_constraint con
          where con.conrelid = a.attrelid
            and con.contype = 'p'
            and a.attnum = any(con.conkey)
          limit 1
        ) pk on true
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      )
    ) as t
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
  ) s;
$$;

comment on function public.db_browser_schema() is
  'Tables/views in the public schema with their columns, for the /db table browser. Read-only.';

create or replace function public.db_browser_counts()
returns table (table_name text, row_count bigint)
language plpgsql
stable
as $$
declare
  r record;
  n bigint;
begin
  for r in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind in ('r', 'p', 'm')
    order by c.relname
  loop
    execute format('select count(*) from public.%I', r.relname) into n;
    table_name := r.relname;
    row_count := n;
    return next;
  end loop;
end;
$$;

comment on function public.db_browser_counts() is
  'Exact row count per table in the public schema, for the /db table browser. Read-only.';

-- Revoking from `public` alone isn't enough: Supabase's default privileges
-- grant execute on every new public-schema function to anon and authenticated,
-- which would let anyone holding the (public) anon key enumerate table and
-- column names. Revoke those explicitly too.
revoke all on function public.db_browser_schema() from public, anon, authenticated;
revoke all on function public.db_browser_counts() from public, anon, authenticated;
grant execute on function public.db_browser_schema() to service_role;
grant execute on function public.db_browser_counts() to service_role;

notify pgrst, 'reload schema';
```

## Endpoints

| Route | Returns |
|---|---|
| `GET /api/db/tables` | Every table/view with its columns. Cached 30s; `?refresh=1` skips the cache. |
| `GET /api/db/counts` | `{ [table]: rowCount }`, exact. |
| `GET /api/db/rows` | A page of rows: `?table=&page=&pageSize=&sort=&dir=&q=`. |
| `GET /api/db/rows?full=1&pk={…}` | One row, nothing truncated — what the drawer's "Load full values" calls. |

A `501` with `setupRequired: true` means the two functions above aren't
installed or aren't reachable with the key in use.

## Things worth knowing

- **Search** (`q`) matches a substring, case-insensitively, across every text
  column, and matches `uuid`/number columns exactly when the term parses as one.
  `%` and `_` in the term act as SQL wildcards. Dates, booleans and jsonb aren't
  searched — PostgREST can't express the cast those would need in a filter.
- **Sorting** defaults to `created_at` descending, falling back to the primary
  key and then the first column. A sort on a non-unique column adds the primary
  key as a tiebreaker, so rows don't shuffle between pages.
- **Long values** (over 512 characters — base64 images, transcripts, big jsonb)
  are cut down for the grid, marked with an amber `…`, and refetched in full by
  the drawer on request. Tables with no primary key can't refetch, so the drawer
  shows the shortened value with a note.
