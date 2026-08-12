# Security lockdown runbook

Today the app ships the public Supabase **anon key** to the browser and every
table/bucket has "allow all" policies for `anon`, so anyone can read/write/
delete the whole database and storage. This branch closes that off:

1. A **password gate** (middleware) in front of the whole app + API.
2. The server Supabase client uses the **service-role key** (bypasses RLS),
   so the app keeps working once the open policies are removed.
3. A final DB step **revokes anon access** and **removes anon write on storage**.

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
