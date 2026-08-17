# Security lockdown runbook

> **STATUS: COMPLETED.** Code (steps 1–2) merged to production and the three env
> vars (`SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD`, `SESSION_TOKEN`) are set for
> Production + Preview. The database step ran on the live project: **D.1** dropped
> all 144 allow-all public policies, **D.2** dropped all 33 anon storage-write
> policies (11 SELECT/public-read policies kept), and **D.4** pinned the
> `plant_albums` search_path. **D.3 was intentionally skipped** — buckets remain
> public-read. Security advisors now report only the expected
> `rls_enabled_no_policy` INFO notices (RLS on + no policy = deny-all for anon).
> The steps below are retained as the record and for rollback.
>
> **Read [section E](#e-expected-advisor-state--do-not-fix-these) before acting on
> any RLS audit finding.** "RLS enabled but no policies" is the intended end state
> here, not a bug. Adding policies for `anon`/`authenticated` — or disabling RLS —
> would undo this entire lockdown.

Originally the app shipped the public Supabase **anon key** to the browser and
every table/bucket had "allow all" policies for `anon`, so anyone could read/
write/delete the whole database and storage. This closed that off:

1. A **password gate** (middleware) in front of the whole app + API.
2. The server Supabase client uses the **service-role key** (bypasses RLS),
   so the app keeps working once the open policies are removed.
3. A final DB step **revokes anon access** and **removes anon write on storage**.

**Chosen posture:** close the database (no anon read/write) and stop file
tampering (no anon upload/overwrite/delete), but **keep buckets public-read** so
image display needs zero code changes. Concretely: run steps **D.1, D.2, D.4**
and **skip D.3**. Residual risk accepted: an individual file remains downloadable
by anyone who has its exact random-UUID URL — but once D.1 runs, there's no way
to enumerate those URLs, so bulk theft is closed. (To also close that last gap,
switch image display to signed URLs and run D.3 — a later follow-up.)

The code (steps 1–2) is safe to deploy *before* the DB step: the gate is
inactive until `SESSION_TOKEN` is set, and the server falls back to the anon
key until `SUPABASE_SERVICE_ROLE_KEY` is set. **Do the DB step (step D) only
after the new code is live on production and verified**, or the current app
(which relies on the open policies) will break.

## A. Set environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value | Scope |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** secret | Production + Preview. **Never** prefix with `NEXT_PUBLIC`. |
| `APP_PASSWORD` | the shared password staff will type | Production + Preview |
| `SESSION_TOKEN` | a long random secret — `openssl rand -hex 32` | Production + Preview |

Redeploy after setting them.

## B. Verify on the preview (this branch) first

- Visiting any page redirects to `/login`; the password lets you in.
- With the service-role key set, the app reads/writes normally (it's now going
  through server code, not the anon key).
- "Sign out" (top-right of the nav) returns you to `/login`.

## C. Cut over production

Merge this branch to the production branch and confirm the three env vars are
set for **Production**. Verify the live site prompts for the password and works.

## D. Lock the database (run in Supabase → SQL Editor, AFTER C)

This drops the public "allow all" policies. Server code keeps working because
it uses the service-role key, which bypasses RLS. **This immediately breaks any
client still using the anon key**, so only run it once production is on the new
code.

```sql
-- 1) Remove every "allow all" policy on public tables. RLS stays ENABLED, so
--    with no permissive policy left, anon/authenticated get nothing; the
--    service-role key bypasses RLS and is unaffected.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 2) Remove anon/public write (and optionally read) on storage objects.
--    Keeping SELECT public means image <img src> URLs keep working while
--    uploads/deletes are locked to the service role. Drop the SELECT lines too
--    if you also want to make buckets fully private (requires switching image
--    display to signed URLs — a follow-up).
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('INSERT','UPDATE','DELETE')
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- 3) (Optional, full lockdown) make buckets private. Do this ONLY after the app
--    serves images via signed URLs, or images will stop loading.
-- update storage.buckets set public = false;

-- 4) Minor advisor fix: pin the function search_path.
alter function public.plant_albums set search_path = public, pg_temp;
```

## E. Expected advisor state — do not "fix" these

Supabase's linter reports `rls_enabled_no_policy` (INFO) for **every** table in
`public`. That is the deliberate outcome of step D.1, not an oversight:

| | anon / authenticated | service_role (the app) |
|---|---|---|
| read | denied | allowed (bypasses RLS) |
| insert / update / delete | denied | allowed (bypasses RLS) |

RLS is enforced **per role, not per statement**. `service_role` bypasses it
entirely, so there is no state in which reads succeed but writes fail for the
app's own connection — both go through the same server-side client
(`src/lib/supabaseClient.ts`). If reads are working in production, the
service-role key is configured and writes work too.

**A report that "RLS blocks all writes" is therefore a misreading of the
advisor output.** Verify before acting on one — this probe rolls itself back:

```sql
do $$
declare a text; b text;
begin
  begin set local role anon;         insert into public.properties default values; a := 'ALLOWED';
  exception when others then a := SQLERRM; end; reset role;
  begin set local role service_role; insert into public.properties default values; b := 'ALLOWED';
  exception when others then b := SQLERRM; end; reset role;
  raise exception E'anon: %\nservice_role: %', a, b;
end $$;
```

Expected: anon → `new row violates row-level security policy`; service_role →
past RLS (it fails only on a NOT NULL constraint). Last verified 2026-08-17.

Applying either remedy the linter suggests — adding `anon`/`authenticated`
policies, or `disable row level security` — would re-expose all 47 tables to the
public anon key, which **is** shipped to the browser. Neither is wanted. The
browser client is used only for `supabase.storage` uploads; no client-side code
reads or writes tables, so no table needs an anon policy.

### Follow-up fixes applied 2026-08-17

Auditing the above surfaced two genuine issues — one of them the *opposite* of
the reported problem:

1. **`public.tasks` had a leftover `Allow all for authenticated and anon`
   policy** granting role `public` (which includes anon) full read/write/delete
   on every task row. It postdated the D.1 sweep, so it was the one table still
   open. Dropped — `tasks` now matches the other 46.
2. **`vector` extension moved out of `public`** into `extensions` (advisor 0014).
   This required repointing `voicemap_match_nodes` and `voicemap_related_pages`,
   which pinned `search_path = public, pg_temp` and use the pgvector `<=>`
   operator and `vector(384)` cast; without the repoint both would fail with
   `type "vector" does not exist`. Both verified returning rows afterward, and
   the 268 node / 18 wiki embeddings are untouched. Existing `vector` columns
   reference the type by OID and needed no rewrite.

## Rollback

If something breaks after step D, re-create permissive policies to restore the
old behavior (temporary — only while you diagnose):

```sql
-- EMERGENCY ROLLBACK: re-open a single table (repeat per table as needed)
create policy "tmp allow all" on public.<table> for all to public using (true) with check (true);
```

## Notes / follow-ups

- **Fully private storage**: to stop public read of files entirely, switch the
  image URL helpers (`dealPhotoUrl`, `catalogPhotoUrl`, `masterPhotoUrl`,
  `plantImageUrl`, …) to signed URLs generated server-side, then set buckets
  `public = false`. Larger change; do it as a follow-up if required.
- **Per-user accounts**: this gate is a single shared password. Moving to
  Supabase Auth (one login per person) is a later upgrade and the basis for
  per-user permissions.
- Rotating the anon key afterward is optional; once the policies are gone the
  anon key can't do anything anyway.
