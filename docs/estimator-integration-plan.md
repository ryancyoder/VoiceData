# Landscape Estimator → VoiceData Integration Plan

**Goal:** Bring the standalone `landscape-estimator` (Vite SPA/PWA) into
`VoiceData` (Next.js 16) as a first-class `/estimator` feature, backed by
Supabase, with each estimate **linked to a deal** so its total and proposal
flow into the Sales Board.

---

## 1. Where the two apps stand

| | VoiceData | landscape-estimator |
|---|---|---|
| Framework | Next.js 16, App Router, React 19, **TypeScript** | Vite 8, React 19, **JS/JSX** |
| Backend | API routes → Supabase (Postgres 17 + Storage) | none (client-only) |
| Deploy | server | GitHub Pages PWA (`base: /landscape-estimator/`) |
| Estimate persistence | — | `localStorage` (single estimate) |
| Kits persistence | — | `localStorage` |
| Catalog persistence | — | bundled JSON + **dev-only** Vite middleware (no prod save) |
| Plan images | — | base64 data URLs inline in the estimate object |

`VoiceData/tsconfig.json` already has `"allowJs": true`, so the estimator's
`.jsx` files can be dropped in and converted incrementally rather than all at
once. Both apps are on Tailwind v4.

## 2. Target architecture

- New route group `src/app/estimator/` (list + editor), reachable from `NavBar`.
- Estimator React components ported under `src/components/estimator/`.
- Estimator business logic (`useEstimate`, `useCatalog`, `useAssemblyKits`,
  plan math) ported under `src/lib/estimator/` and rewired from
  localStorage/JSON to `fetch` against new API routes.
- New API routes under `src/app/api/estimator/` and
  `src/app/api/sales-board/[id]/estimate/` following the existing
  route/Supabase conventions (see `api/sales-board/[id]/proposal-pdf/route.ts`).
- New Supabase tables + a Storage bucket for plan images.

## 3. Supabase schema changes

### 3.1 New tables

> **Implemented decision (Phase 2):** catalog items and kits are stored as
> whole `jsonb` documents rather than exploded into typed columns. The real
> catalog data is variant-shaped (plain / assembly / wall-assembly, plus
> optional `planSymbol`, `roundTo`, `description`) and the frontend keys off
> camelCase field *presence*. A `data jsonb` column is lossless and needs no
> two-way snake_case↔camelCase mapping. Nothing server-side queries these,
> so the typed-column version below was dropped in favor of the document
> shape actually applied by the `estimator_catalog_kits_settings` migration:

```sql
-- Shared reference catalog (replaces the bundled JSON + dev-only save).
-- `data` holds the full frontend (camelCase) item.
create table public.catalog_items (
  id          text primary key,   -- keep existing ids: 'p1', 'custom-...'
  sort_order  int  not null default 0,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Reusable assembly kits (was localStorage 'landscape-assembly-kits').
-- `data` holds the full frontend (camelCase) kit incl. its client id.
create table public.assembly_kits (
  id          text primary key,   -- client-generated 'kit-...'
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

-- Global settings singleton (delivery rate).
create table public.estimator_settings (
  id            int primary key default 1,
  delivery_rate numeric not null default 80,
  updated_at    timestamptz not null default now(),
  constraint estimator_settings_singleton check (id = 1)
);
```

> `estimates` (Phase 3) keeps typed columns for the relational bits
> (`deal_id`, `property_id`, `value`, `total`) with `jsonb` for `rows`/`plan`,
> as below — that split still applies.

-- Estimates, each optionally linked to a deal + property
create table public.estimates (
  id            uuid primary key default gen_random_uuid(),
  -- One estimate per deal: unique link, so at most one estimate points at
  -- a given deal. Nullable so an estimate can exist before it's attached.
  deal_id       bigint unique references public."Sales Board"(id) on delete set null,
  property_id   bigint references public.properties(id) on delete set null,
  project_name  text default '',
  client_name   text default '',
  estimate_date date,
  tax_rate      numeric not null default 0,
  notes         text default '',
  rows          jsonb not null default '[]',  -- take-off groups + items (as today)
  plan          jsonb not null default '{}',  -- shapes/plants/items/scale (NO image data)
  plan_image_path text,                       -- Storage path, replaces base64 dataUrl
  delivery_rate numeric,                      -- snapshot at estimate time
  subtotal      numeric,                      -- denormalized totals for list view / deal sync
  total         numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.estimates (deal_id);
create index on public.estimates (property_id);

-- Global settings (delivery rate today; room to grow)
create table public.estimator_settings (
  id            int primary key default 1,
  delivery_rate numeric not null default 80,
  check (id = 1)
);
insert into public.estimator_settings (id, delivery_rate) values (1, 80);
```

### 3.2 Storage bucket

- New bucket `estimate-plans` (mirrors the `deal-photos` / `deal-documents`
  pattern). Plan images upload here; the estimate row keeps only
  `plan_image_path`. Add a `planImageUrl(path)` helper alongside the existing
  `dealPhotoUrl` helpers in a new `src/lib/estimator/estimate.ts`.
- **Migration note:** plan images currently live as base64 data URLs inside
  the estimate JSON. On import they must be uploaded to the bucket and the
  data URL replaced with the path.

### 3.3 RLS (must match existing tables)

All existing feature tables have RLS **enabled** with a uniform pattern
(confirmed by inspecting `pg_policies`): four PERMISSIVE policies per table —
one each for SELECT/INSERT/UPDATE/DELETE — all `using (true)` / `with check
(true)`, granted to `anon, authenticated`. Fully open, single-tenant. The
Phase 2 tables replicate this exactly (applied in the migration):

```sql
alter table public.catalog_items       enable row level security;
alter table public.assembly_kits       enable row level security;
alter table public.estimator_settings  enable row level security;
-- + four "allow all" policies per table for anon, authenticated
--   (using true / with check true), matching every existing table.
-- estimates (Phase 3) will follow the same pattern.
```

> **Pre-existing security gap (surface, don't auto-fix):** Supabase's advisor
> flags `public.action_history` with **RLS disabled** — anyone with the anon
> key can read/write it. Remediation is `ALTER TABLE public.action_history
> ENABLE ROW LEVEL SECURITY;` **plus** policies (enabling without policies
> blocks all access). This is unrelated to the estimator but should be decided
> on before we add more anon-key tables.

## 4. API routes (new)

Following the existing `NextRequest`/`supabase`/`NextResponse` conventions:

**Phase 2 — DONE** (simpler than first sketched; the app edits locally then
saves, so the catalog is a collection replace and settings ride with it):

| Route | Methods | Purpose |
|---|---|---|
| `api/estimator/catalog/route.ts` | GET, PUT | get full catalog + delivery rate / replace-all on Save (upsert + delete-missing, updates settings) |
| `api/estimator/kits/route.ts` | GET, POST | list kits / create a kit |
| `api/estimator/kits/[id]/route.ts` | PATCH, DELETE | update (merge into `data`) / remove kit |

**Phase 3+ (planned):**

| Route | Methods | Purpose |
|---|---|---|
| `api/estimator/estimates/route.ts` | GET, POST | list / create estimates |
| `api/estimator/estimates/[id]/route.ts` | GET, PUT, DELETE | load / save / delete one estimate |
| `api/estimator/estimates/[id]/plan-image/route.ts` | POST, DELETE | upload/remove plan image (Storage) |
| `api/sales-board/[id]/estimate/route.ts` | GET, PUT | the deal's single estimate (one-to-one); PUT upserts on `deal_id` and pushes total→`value` + generated PDF→`proposal_pdf_path` |

## 5. Frontend port — file by file

**Bring over (→ `src/components/estimator/`):** `CatalogPanel`, `CatalogCard`,
`CatalogEditor`, `EstimatePanel`, `EstimateHeader`, `EstimateRow`,
`EstimateSummary`, `TakeOffGroupRow`, `QuickPicker`, `ImportModal`,
`AssemblyKitModal`, `PlanView`, `PlanCanvas`, `PlanShapeList`, `PrintView`.

**Bring over (→ `src/lib/estimator/`):** `useEstimate`, `useCatalog`,
`useAssemblyKits`, `catalog.js` (categories/metacategories/colors), plan math
helpers.

**Rewrite:**
- `useCatalog` / `useAssemblyKits` / `useEstimate` — swap
  `localStorage`/`fetch('/api/save-catalog')` for the new API routes; add
  loading/saving state (they're currently synchronous).
- `App.jsx` → split into `src/app/estimator/[id]/EstimatorClient.tsx` (the
  editor) and `src/app/estimator/page.tsx` (estimate list).
- Plan image upload → POST to the plan-image route instead of embedding base64.
- Save/Load-file (JSON download) can stay as an export/import escape hatch.

**Drop:** `main.jsx`, `index.html`, `vite.config.js`, the PWA config, the
`catalog-save` middleware, `base` path.

**Nav:** add `{ href: "/estimator", label: "Estimator" }` to `NAV_ITEMS` in
`src/components/NavBar.tsx`.

## 6. Deal linkage (the payoff)

- From a deal (`DealModal`), "Create estimate" opens the editor with
  `deal_id` + `property_id` prefilled (project/client name seeded from the
  property's contact).
- Saving an estimate writes back to the deal:
  - `Sales Board.value` ← estimate `total`
  - proposal PDF (rendered from `PrintView`) → `estimate-plans`/`deal-documents`
    and set `proposal_pdf_path` (reuse the existing proposal-pdf route logic).
- The deal detail view lists its estimate(s) with total + a link to open.

## 7. Phasing & rough effort

1. **Port only** — estimator runs at `/estimator` on localStorage, no schema
   changes. *(~1 day, low risk)*
2. **Catalog + kits + settings → Supabase** — kills the dev-only-save problem.
   *(~1 day)*
3. **Estimates → Supabase + estimate list; plan images → Storage.** *(~2–3 days,
   the bulk)*
4. **Deal linkage** — total→value, proposal PDF, deal detail integration.
   *(~1–2 days)*

## 8. Open questions

- Confirm the exact RLS policy shape used on existing tables so new tables
  match (single-tenant anon vs. authenticated).
- ~~Multiple estimates per deal (versions/revisions) or one-to-one?~~
  **Decided: one estimate per deal** (unique `deal_id`).
- Decide on the `action_history` RLS gap before adding more anon-key tables.
- Keep the JSON import/export escape hatch, or Supabase-only?
