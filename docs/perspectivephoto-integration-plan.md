# PerspectivePhoto → VoiceData Integration Plan

**Goal:** Bring the standalone `PerspectivePhoto` app (Vite SPA, Konva canvas,
browser-only) into `VoiceData` (Next.js 16) as a first-class `/design` feature,
backed by Supabase, with each design **linked to a deal / property** so a
jobsite photo already in the system can be used as the canvas and the finished
render flows back onto the Sales Board.

This mirrors `docs/estimator-integration-plan.md` — the landscape-estimator port
is the working precedent for absorbing a standalone Vite/React app into
VoiceData. PerspectivePhoto is the same shape of problem (Vite 8 / React 19 SPA,
no backend) with two differences: it is a **Konva canvas** app (client-only
rendering) and it stores **everything — the background photo, every plant PNG,
and the plan-view images — as inline base64**. Lifting that onto Supabase
Storage is the bulk of the work.

---

## 1. Where the two apps stand

| | VoiceData | PerspectivePhoto |
|---|---|---|
| Framework | Next.js 16, App Router, React 19, **TypeScript** | Vite 8, React 19, **TypeScript** (Konva / react-konva) |
| Router | App Router | none (Zustand `viewMode` state) |
| Backend | API routes → Supabase (Postgres 17 + Storage) | **none** (client-only) |
| Deploy | server | GitHub Pages (`base: /PerspectivePhoto/`) |
| Persistence | Supabase tables + public Storage buckets | **IndexedDB** (`perspectivephoto` db, v3) |
| Library persistence | — | IndexedDB `custom-stamps` + `plan-symbols` stores |
| Project persistence | — | IndexedDB `project-state` store, single `'current'` key |
| Images | Storage objects; DB keeps only the path | **base64 data URLs inline** in every record |
| Auth | none (single-tenant, open RLS) | none |
| Styling | Tailwind v4 | Tailwind v4 |

Both apps are React 19 + Tailwind v4 + **TypeScript**, so the stack lines up
cleanly — PerspectivePhoto is actually better positioned than the estimator was
(that port was untyped JSX; `allowJs` is not even needed here).

**What PerspectivePhoto persists today** (all browser-local, in
`src/store/useCustomStampStore.ts`):
- `custom-stamps` / `plan-symbols` — the reusable plant & plan-symbol
  **libraries**. Each record is a `CustomStamp` holding `dataUrl` (full image as
  base64 PNG) plus dimensions, category, `botanicalName`, `commonName`, `notes`.
- `project-state` → key `'current'` — the **one active project**, auto-saved on
  a 1s debounce (`useProjectStore.ts`): `backgroundImage` (photo as data URL),
  `stamps[]`, `planStamps[]`, `perspective`, `planView` (`image` +
  `selectionImage` + `eraseMask`, all data URLs), and `lightingConfig`.

There is exactly **one implicit project per browser**, no identity, no server.
That is the whole surface to lift.

## 2. Target architecture

- New route group `src/app/design/` (design **list** + editor), reachable from
  `NavBar`. `/design` is the list; `/design/[id]` is the editor.
- PerspectivePhoto React components ported under `src/components/design/`.
- Engine + store logic (`engine/perspective.ts`, `engine/homography.ts`,
  `store/useProjectStore.ts`, `store/useCustomStampStore.ts`) ported under
  `src/lib/design/` and rewired from IndexedDB to `fetch` against new API routes.
- New API routes under `src/app/api/design/` following the existing
  route/Supabase conventions (async `params`, `NextResponse`, Supabase error →
  500, Storage rollback on DB-insert failure).
- New Supabase tables + Storage buckets (§3), each design optionally linked to a
  deal / property / event.

**Konva is client-only.** The editor must load behind `next/dynamic({ ssr:
false })` inside a `'use client'` route — exactly what the estimator editor at
`/estimator/[id]` already does. All `window` / `canvas` / `navigator.clipboard`
access sits behind that boundary.

## 3. Supabase schema changes

### 3.1 New tables

Following the estimator's decision: typed columns for the relational bits,
`jsonb` for the variant-shaped document, **Storage paths instead of base64**.

```sql
-- Shared reusable plant/plan-symbol library (replaces the two IndexedDB
-- library stores). `data` holds the frontend (camelCase) metadata; the image
-- moves to Storage and is referenced by image_path.
create table public.pp_library_items (
  id          text primary key,          -- keep existing client ids (uuid/'custom-...')
  kind        text not null              -- which library this belongs to
              check (kind in ('perspective-stamp', 'plan-symbol')),
  data        jsonb not null,            -- name/botanicalName/commonName/notes/dims/category
  image_path  text,                      -- Storage path in the pp-library bucket
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now()
);

-- Designs, each optionally linked to a deal / property / event.
-- Many designs may point at the same deal (decided) — deal_id is a plain FK,
-- not unique. This is the opposite of estimates' one-per-deal constraint.
create table public.pp_projects (
  id                uuid primary key default gen_random_uuid(),
  deal_id           bigint references public."Sales Board"(id) on delete set null,
  property_id       bigint references public.properties(id)   on delete set null,
  event_id          bigint references public.events(id)       on delete set null,
  name              text not null default 'Untitled design',
  perspective       jsonb not null default '{}',   -- horizon/ground/baseScale
  plan_view         jsonb not null default '{}',   -- shapes/scale, NO image data
  lighting_config   jsonb not null default '{}',   -- light sources
  stamps            jsonb not null default '[]',   -- placed perspective stamps
  plan_stamps       jsonb not null default '[]',   -- placed plan symbols
  background_image_path text,                       -- Storage path, replaces base64
  plan_image_path       text,                       -- plan-view base image
  plan_selection_path   text,                       -- plan selection crop
  plan_erase_mask_path  text,                       -- plan erase mask
  render_path           text,                       -- exported flattened PNG
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.pp_projects (deal_id);
create index on public.pp_projects (property_id);
create index on public.pp_projects (event_id);
```

> **In-memory undo/redo history** (`useProjectStore` `history[]`, max 50) stays
> client-side and is intentionally *not* persisted.

### 3.2 Storage buckets

Two new public buckets, mirroring the `deal-photos` / `estimate-plans` pattern
(path stored in the DB, public URL constructed via a helper):

- `pp-library` — the plant/plan-symbol PNG cutouts (one object per library
  item).
- `pp-designs` — per-design images: background photo, plan-view base/selection/
  erase-mask images, and the exported render.

Add `ppLibraryUrl(path)` / `ppDesignUrl(path)` helpers alongside the existing
`dealPhotoUrl` family, in a new `src/lib/design/storage.ts`, reusing
`storagePaths.safeExtension`.

> **Reuse option:** for **CRM-native** designs the background can be picked
> straight from the existing `deal-photos` bucket / `deal_photos` table rather
> than re-uploaded — store that photo's existing `storage_path` in
> `background_image_path` and skip the upload entirely (§6).

### 3.3 RLS (must match existing tables)

Every existing feature table has RLS **enabled** with four PERMISSIVE policies
(SELECT/INSERT/UPDATE/DELETE), all `using (true)` / `with check (true)`, granted
to `anon, authenticated` — fully open, single-tenant. The new tables must
replicate this exactly or they will be unreachable via the anon key:

```sql
alter table public.pp_library_items enable row level security;
alter table public.pp_projects      enable row level security;
-- + four "allow all" policies per table for anon, authenticated
--   (using true / with check true), matching every existing table.
```

> **Pre-existing security gap (surface, don't auto-fix):** Supabase's advisor
> flags `public.action_history` with **RLS disabled** — anyone with the anon key
> can read/write it. Remediation is `ALTER TABLE public.action_history ENABLE
> ROW LEVEL SECURITY;` **plus** policies (enabling without policies blocks all
> access). Unrelated to this work, but — as the estimator plan already noted —
> it should be decided **before** adding more anon-key tables, and this plan adds
> two.

## 4. API routes (new)

Following the existing `NextRequest` / `supabase` / `NextResponse` conventions:

| Route | Methods | Purpose |
|---|---|---|
| `api/design/library/route.ts` | GET, PUT | full library (both kinds) / collection replace on save (upsert + delete-missing) |
| `api/design/library/image/route.ts` | POST, DELETE | upload/remove a library item's PNG in the `pp-library` bucket |
| `api/design/projects/route.ts` | GET, POST | list design summaries / create (blank, or prefilled from a deal) |
| `api/design/projects/[id]/route.ts` | GET, PUT, DELETE | load / **autosave** content / delete (also removes design images) |
| `api/design/projects/[id]/image/route.ts` | POST, DELETE | upload/remove a design image (background, plan images, render) in `pp-designs` |
| `api/sales-board/[id]/design/route.ts` | GET, POST | the deal's designs — GET lists them, POST creates one prefilled from the deal (name from deal, `property_id` carried over) |

Notes (copy the estimator editor's proven approach):
- The editor **autosaves** the JSON document (debounced PUT). PUT deliberately
  **never rewrites images and never touches `deal_id`/`property_id`**, so
  autosave can't unlink a deal or re-upload multi-MB blobs.
- **Images upload once on change** to Storage; the JSON keeps only paths. On
  read, data URLs are *derived* from paths for Konva; on write they are
  *stripped*. This is the same `imageDataUrl` ↔ `*_path` move the estimator made
  for plan images — but PerspectivePhoto has several image fields, not one.

## 5. Frontend port — file by file

**Bring over (→ `src/components/design/`):** the `Canvas/` set
(`EditorCanvas`, `BackgroundImage`, `PlanOverlay`), `PlanView/`
(`PlanViewCanvas`, `PlanCanvas`), `Lighting/` (`LightingCanvas`),
`GestureControls/`, `StampLibrary/` (`ObjectStrip`, `TextureGrid`), `Toolbar/`,
`PropertiesPanel/`, `PlantTable.tsx`, `SettingsMenu.tsx`.

**Bring over (→ `src/lib/design/`):** `engine/perspective.ts`,
`engine/homography.ts`, `engine/textureAssets.ts`, `engine/categoryGroups.ts`,
`engine/personSilhouette.ts`, and both Zustand stores
(`useProjectStore`, `useCustomStampStore`).

**Rewrite:**
- `store/useCustomStampStore.ts` — replace the entire IndexedDB layer
  (`openDB`/`dbGetAll`/`dbPut`/`dbDelete`/`saveProjectState`/`loadProjectState`)
  with `fetch` against the new API routes; add loading/saving state (it is
  synchronous today). Drop the `localStorage → IndexedDB` migration helper.
- `store/useProjectStore.ts` — the 1s `subscribe` auto-save that serializes a
  base64 blob becomes: images uploaded on pick (§4), the lightweight JSON PUT
  debounced. Rehydrate from the API instead of `loadProjectState()`.
- Image upload paths (`ObjectStrip.tsx`, `TextureGrid.tsx`, `Toolbar.tsx`,
  `PlanViewCanvas.tsx`) — `FileReader.readAsDataURL` / clipboard paste now POST
  the file to a Storage route and keep the returned path; Konva renders from the
  derived public URL.
- `App.tsx` → split into `src/app/design/[id]/DesignClient.tsx` (the editor,
  `next/dynamic ssr:false`) and `src/app/design/page.tsx` (the design list).
- PNG **export** (`Toolbar.tsx` `stage.toDataURL`) keeps the browser download,
  and additionally uploads the render to `pp-designs` (`render_path`) so it can
  surface on the deal.

**Drop:** `main.tsx`, `index.html`, `vite.config.ts`, the PWA/GitHub-Pages
config, the `base: '/PerspectivePhoto/'` path, `.github/workflows/deploy.yml`.

**Nav:** add `{ href: "/design", label: "Design" }` to `NAV_ITEMS` in
`src/components/NavBar.tsx`.

## 6. Deal linkage (the payoff)

This is the CRM-native integration and the reason to do this inside VoiceData
rather than keep a standalone tool:

- **Create/open from a deal:** `DealModal` gets a Design row — "Open design"
  when one exists, else "+ Create design" which POSTs to
  `api/sales-board/[id]/design` and navigates to `/design/[id]` with `deal_id` /
  `property_id` prefilled.
- **Background from existing jobsite photos:** instead of uploading, the editor
  can pick a photo already attached to the deal/property from `deal_photos`
  (reached the normal way, via the deal's `events`) and use its `storage_path`
  directly as `background_image_path`. This is the integration unique to
  PerspectivePhoto — the estimator had no equivalent.
- **Render back onto the deal:** the exported flattened PNG can be written into
  `deal_photos` with `photo_type = 'Site_Plan_Image'` (a value that already
  exists), so the design shows up in the deal's gallery / calendar alongside the
  raw jobsite photos.

## 7. Phasing & rough effort

1. **Port only** — PerspectivePhoto runs at `/design` inside VoiceData, still on
   IndexedDB, no schema changes. Konva behind `next/dynamic ssr:false`. Proves
   the framework port in isolation. *(~1 day, low risk)*
2. **Library → Supabase** — `pp_library_items` + `pp-library` bucket; rewrite the
   two library stores from IndexedDB to the API. *(~1 day)*
3. **Projects + images → Supabase** — `pp_projects` + `pp-designs` bucket; the
   design list; **all base64 → Storage paths**; rework the autosave. This is the
   bulk. *(~2–3 days)*
4. **Deal linkage** — create-from-deal, background-from-`deal_photos`, render
   back as `Site_Plan_Image`, deal-detail integration. *(~1–2 days)*

**Rough total: ~5–7 focused days**, same ballpark as the estimator port, each
phase independently shippable.

## 8. Open questions

- Confirm the `action_history` RLS gap decision before adding the two new
  anon-key tables (§3.3).
- ~~One design per deal, or many (versions/revisions)?~~ **Decided: many designs
  per deal** — `deal_id` is a plain FK, not unique (the opposite of estimates'
  one-per-deal). The deal's Design row therefore lists/creates multiple, and
  `api/sales-board/[id]/design` GET returns a list.
- Should the background always be a copy in `pp-designs`, or a direct reference
  to the existing `deal_photos` object? Referencing avoids duplication but
  couples a design to a photo that could be deleted; copying is safer but
  duplicates storage. (Leaning: copy on first use.)
- Keep the JSON library export/import (`exportLibrary`/`importLibrary`) as an
  escape hatch, or Supabase-only?
- Konva/react-konva is a large client bundle — lazy-loaded behind the editor
  route so it does not weigh on the rest of VoiceData; confirm acceptable.
