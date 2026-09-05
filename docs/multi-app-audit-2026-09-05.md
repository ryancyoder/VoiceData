# Multi-app audit and game plan

**Date:** 2026-09-05
**Scope:** MasterDash, VoiceData, Upright, VoiceMap, Elevation, PerspectivePhoto — six repos, one Supabase project (`ktgpjizfntdfpghalukx`), one Vercel team.
**Rule for this document:** nothing was changed. Every claim cites a file and line so it can be checked. Upright citations are against the real `main` (2026-08-31), noted as `Upright(main)`, because the checkout this audit was handed was 66 commits behind — see §2.1.

---

## 0. Executive summary

The six apps are not six products. They are **three products and three prototypes that grew into products**, all writing to one database, built by one person with an AI agent over five weeks, each in its own repo with its own conventions. The duplication is real but it is mostly *re-derivation*, not copy-paste: the same landscape-yard problems (measure a bed, place a plan on satellite, take a photo with a gloved hand, survive no signal) were solved independently four or five times, and the solutions disagree in small numerical ways that matter.

The ten findings that should drive the next month, in order:

| # | Finding | Where | Why it matters |
|---|---|---|---|
| 1 | **Two estimators write the same deal's value with incompatible maths.** MasterDash `quick_estimates` (marked-up, untaxed, `Math.ceil` rounding) and VoiceData `estimates` (un-marked-up, taxed, `Math.round`). Neither sees the other's rows. | `MasterDash/lib/estimator/assemblies.ts:115`, `VoiceData/src/lib/estimator/useEstimate.js:178,863`, `MasterDash/README.md:3661` | Same job, same catalog row, one ton apart. `Sales Board.value` is last-writer-wins between two engines. |
| 2 | **MasterDash has no authentication at all** while writing `Sales Board`, `deal_photos`, `master_photos`, `plants`, `property_map_layers`. | `MasterDash/app/api/*` (no `middleware.ts`), `README.md:3850` | The tables VoiceData spent a runbook locking down are writable by any anonymous caller through MasterDash. |
| 3 | **The schema has no source of truth.** 87 live tables, 165 applied migrations, **one** `.sql` file vendored anywhere. | `MasterDash/supabase/migrations/20260828_property_map_layers.sql` is the only one | Every cross-app type is hand-written from memory; a column rename is a runtime 502 in one app and silence in another. |
| 4 | **Upright's writes were fire-and-forget until 31 Aug; a 20-minute visit was lost.** Main now has an IndexedDB outbox for audio only. Everything else in Upright is still RAM-only. | `Upright(main)/CLAUDE.md:1341-1400`, `index.html:2214,2301,2323` | Upright is where field data is *created*. Both downstream apps carry workarounds for its lost writes. |
| 5 | **Two secrets are logged as prefixes on every call.** VoiceMap logs the user's Anthropic key prefix to the browser console; the Upright edge function logs both its AssemblyAI and Anthropic key prefixes to the function log at boot. | `VoiceMap/index.html:4144`; `Upright(main)/supabase/functions/upright-api/index.ts:89-91` | VoiceMap also stores the raw key in `localStorage` and sends it from the browser with `anthropic-dangerous-direct-browser-access`. |
| 6 | **Five different earth models measure the same yards.** Flat 111320 (Upright, 8 copies), flat 110540 (Upright, one copy), IUGG sphere (Elevation), 6371000 sphere (VoiceData), WGS84 ellipsoid (MasterDash). Plus a vertex-anchored shoelace in Upright that gives different bed areas clockwise vs anticlockwise. | §4.3 | ~7 cm disagreement on a 30 m plan; 1.5 sq ft on a bed. Small, but two apps quoting one yard print different numbers. |
| 7 | **The elevation maths is mirrored in two repos and both claim a regression test that does not exist.** MasterDash also dropped Upright's `hidden` check, and Upright still has the export/playback drift bug MasterDash diagnosed. | `MasterDash/lib/estimator/survey.ts:17-19`, `Upright(main)/CLAUDE.md:1615-1622`, `index.html:5833,5873` | The one duplication everyone documented has no safeguard. |
| 8 | **Upright's edge function now reads MasterDash's `quick_estimates` table directly**, and VoiceData reads Upright's tables directly, while MasterDash deliberately goes through the edge function. Three apps, three access conventions, one stated rule. | `Upright(main)/supabase/functions/upright-api/index.ts:502-504`; `VoiceData/src/lib/uprightImport.ts:100,111`; `MasterDash/lib/server/upright.ts:13-19` | `quick_estimates.lines.takeoff.shapes` is now an undeclared contract MasterDash can break silently. |
| 9 | **No app links to any other app.** Six deployed URLs, zero hyperlinks between them, no shared nav. VoiceData's Launch Pad tiles are all internal routes. | `VoiceData/src/components/TileLauncher.tsx:15-29` | The user navigates by bookmark. This is the most visible UI inconsistency and the cheapest to fix. |
| 10 | **Five accent colours, seven modal scrims, six `LONG_PRESS_MS` constants, nine copies of one palette inside VoiceData alone, and only one app (Elevation) defines a touch-target size.** | §5 | The field-usability problems MasterDash's README argues about most (gloves, sun) are the ones its own chrome fails: 26–32 px header buttons. |

Two branch-hygiene facts change how any of this gets done: **VoiceData has no `main` branch** (production deploys from `claude/voice-database-builder-luk2s9`), and **PerspectivePhoto has no `main` either**. See §2.

---

## 1. The fleet

| App | What it is | Stack | Size | Deploy | Last commit | Tests / CI |
|---|---|---|---|---|---|---|
| **VoiceData** | The office. Sales board, properties, photos, calendar, tasks, plants, master catalog, planner, agent-ops console, VoiceMap viewer/wiki, and two absorbed apps (legacy estimator at `/estimator`, PerspectivePhoto at `/design`). Holds the service-role key and the password gate. | Next 16.3 / React 19.2.8 / Tailwind v4 **and** 12 CSS modules | ~395 files, 158 routes + pages | Vercel `voice-data`, production branch **`claude/voice-database-builder-luk2s9`** | 2026-09-04 | **none / none** |
| **MasterDash** | The field estimator. POS-style tile grid; one tap = one purchase increment. Job board, plan take-off on a hand-rolled satellite canvas, visit review with Upright audio/transcript, offline-first op-log sync. | Next 16.2 / React 19.2.4 / Tailwind v4, token file | ~96 files, 5,020-line `PlanPage.tsx` | Vercel `masterdash`, `main` | 2026-09-05 | 6 test scripts / CI runs lint+tsc+build **but not the tests** |
| **Upright** | The site session recorder. Continuous audio + tilt-triggered clips + photo pins + sketches + measures + relative elevation survey + sections/contours + plan overlay + proposal helper. Single 571 KB HTML file plus a Deno edge function. | Vanilla JS, Leaflet from CDN, ffmpeg.wasm | 11,824-line `index.html`, 1,287-line edge fn + `match.ts` + `proposal.ts` | Vercel `upright-master-audio-test`, `main` | 2026-08-31 | `test61..65.js` at repo root (Node + Playwright), no runner, no CI |
| **VoiceMap** | Voice-first idea capture: cards, mind map, kanban, week calendar. Direct browser calls to Claude with a user-pasted key. Syncs to VoiceData. | Single 12,484-line HTML file | 526 KB | Not on Vercel (Add-to-Home-Screen file); `main` | 2026-08-14 | none |
| **Elevation** | Perspective photo ruler: mark two known points, solve the camera, project elevation lines onto the photo. Grew a site-survey front end copied from Upright's ergonomics. | Vanilla ES modules, vendored Leaflet | 2,382-line `App.js` + 9 core modules | Vercel `elevation`, `main` | 2026-08-30 (one day, 7 commits) | `tests/run.mjs` ~180 assertions, no CI |
| **PerspectivePhoto** | Plant-stamp collage over a photo with horizon-based scaling, plan view, lighting. | Vite / React 19 / Konva / Zustand / TS **6** | 62 files | GitHub Pages | 2026-08-08 | none / deploy-only workflow |

Two more things live in the same Supabase project but outside this audit's scope: a separate **MindMap** repo (Vercel project `mindmap`, tables `mindmap_*`) and the `site_visit_*` / `agent_*` tables driven by VoiceData's agent-ops console. Two unlinked legacy Vercel projects (`upright-dual-stream-test`, `upright-video-notepad`) are still deployed.

---

## 2. Repo, branch and deploy hygiene

These are not code-quality findings. They are the reasons an agent working in any one repo cannot see what the others are doing.

### 2.1 The audit checkout of Upright was 66 commits stale

The branch this audit was cut from (`claude/github-installation-setup-bob4d5`, 2026-08-24) is not `main`. Upright `main` (2026-08-31) is 12,319 lines larger: elevation views with four section cuts, Delaunay surface with contours and drainage, object types as shoot orders, bed outlining by aiming the camera, past sessions as map tiles, property matching, a Claude proposal helper, and the audio outbox. Any agent handed the same branch would report Upright as a much smaller app than it is. **Every audit agent in this run initially did exactly that** and had to be re-pointed.

### 2.2 VoiceData and PerspectivePhoto have no `main`

- VoiceData: 28 branches on GitHub, all `claude/*`. Vercel production deploys from `claude/voice-database-builder-luk2s9`. Four other branches (`voicedata-clipboard-paste-photo`, `upright-masterdash-integration`, …) carry the same head. There is no branch whose name says "this is the app".
- PerspectivePhoto: two `claude/*` branches; the GitHub Pages workflow still triggers on `claude/perspective-plant-collage-app-VqFkG` (`.github/workflows/deploy.yml:6`).

### 2.3 The deployed edge function is ahead of its docs

`upright-api` is deployed at **v35**. `Upright(main)/CLAUDE.md:107` says v32; the stale checkout said v17. The vendored source on `main` is byte-identical to what is deployed (verified), so the repo is not behind, only the note. `CLAUDE.md:101-107` also warns that pushing `index.ts` alone deletes `proposal.ts` and every `/proposal` route — a real deploy hazard with no guard.

### 2.4 Schema: 165 migrations applied, one vendored

`list_migrations` returns 165 named migrations from 2026-08-04 to 2026-09-04. In git: one file. VoiceData, which owns ~40 tables, has no `supabase/` directory. Upright has functions but no migrations. The nearest thing to schema docs are prose in `Upright/CLAUDE.md` and two VoiceData integration plans whose `create table` blocks are plans, not history. VoiceData reads the live schema from PostgREST's OpenAPI document at runtime (`src/lib/tableBrowser.ts:10-13`), which is a workaround that confirms nobody has it in a file.

### 2.5 Live security advisory

`public.plaud_processed` has **RLS disabled** (Supabase advisor, critical). With the anon key having zero grants elsewhere this is the one table any holder of the anon key can read and write. Remediation the advisor suggests, not applied:

```sql
ALTER TABLE public.plaud_processed ENABLE ROW LEVEL SECURITY;
```

### 2.6 Tests exist in three repos and CI runs none of them

| Repo | Tests | CI runs them? |
|---|---|---|
| MasterDash | `scripts/test-{review,plan,board,visit}.ts`, `test-sw.mjs`, `test-board-ui.mjs` | **No.** `ci.yml:26-36` runs eslint, tsc, build, stops. |
| Elevation | `tests/run.mjs` | No CI. |
| Upright | `test61.js`…`test65.js` at repo root (property matcher, aiming-cross geometry, three Playwright UI tests; `test59` is referenced in docs) | No package.json, no CI. `test62.js:5-6` extracts functions out of `index.html` by source — a technique worth keeping. |
| VoiceData, VoiceMap, PerspectivePhoto | none | — |

### 2.7 Version drift

Next 16.2.2 vs 16.3.0; React 19.2.4 vs 19.2.8; TypeScript `^5` (both Next apps) vs `~6.0.2` (PerspectivePhoto), whose engine files are compiled under both; `@types/node ^20` vs `^24`; `@anthropic-ai/sdk ^0.115` (VoiceData) vs `^0.122` (MasterDash), which is why VoiceData hand-writes JSON-Schema tools where MasterDash uses zod structured output.

### 2.8 Docs that contradict code

- `PerspectivePhoto/README.md` is the untouched Vite template; `ARCHITECTURE.md:13` says React 18 (it is 19).
- `VoiceMap/CLAUDE.md:5` says ~6,200 lines; it is 12,484.
- `Upright/README.md:4` says ~88 KB; `main` is 571 KB.
- `VoiceData/README.md:97,104` cite routes that live under `api/properties/`, not `api/sales-board/`; the README describes roughly a third of the app (no `/design`, `/estimator`, `/agent-ops`, `/voicemap`, `/planner`).
- `MasterDash/lib/estimator/survey.ts:17-19` and `Upright(main)/CLAUDE.md:1615-1622` both describe a survey regression test. Neither repo contains one.
- Three different homes for architecture: README-only (MasterDash, Elevation), CLAUDE.md-primary (Upright, VoiceMap), ARCHITECTURE.md (PerspectivePhoto), CLAUDE.md→AGENTS.md (VoiceData).

---

## 3. Feature overlap map

Where the same user-facing job is done in more than one app. ● full implementation, ◐ partial or read-only, — absent.

| Job | VoiceData | MasterDash | Upright | VoiceMap | Elevation | PerspectivePhoto |
|---|---|---|---|---|---|---|
| Deal pipeline / board | ● kanban, tiles, table, phone swipe | ● one-stage-per-page job board (writes `board_order`) | — | ● kanban (own cards, not deals) | — | — |
| Estimate a job | ● legacy `/estimator` (rows, kits, typed qty) | ● quick estimator (taps, buckets, op log) | ◐ proposal helper suggests lines from transcript | — | — | — |
| Plan take-off on a map | ● pixel-space plan canvas (legacy) | ● lat/lng canvas, satellite, curves, plant mass | ◐ renders MasterDash's shapes as a read-only layer | — | — | — |
| Georeferenced plan overlay | — | ● `property_map_layers` (many per property) | ● `sessions.plan_*` (one per session) | — | ● transient, feet, opposite rotation sign | — |
| Satellite basemap | ◐ OSM (not satellite) on two small maps | ● hand-rolled Esri tile canvas ×2 (PlanCanvas, JobBoard mosaic) | ● Leaflet Esri + past-sessions mosaic | — | ● vendored Leaflet Esri | — |
| Photo capture with camera | ● `CameraCapture` | — (file input) | ● pins + grade frames + stance photos | ◐ file input | ● sight view | — |
| Photo annotation / drawing | ● `PhotoAnnotator` (pen, shapes, prism) | — | ● two editors (pre-capture burn-in, post-capture strokes) | ● draw tools (the file PhotoAnnotator was ported from) | ● measurement annotations | ● Konva stamps |
| Photo gallery / rail | ● albums, lightbox | ● square review rail | ● filmstrip + review rail (two sizes) | ● 3-col gallery | — | — |
| Relative elevation survey | — | ◐ mirrored `elevationOf`/`slopeOf`, read-only | ● | — | ● re-derived, absolute model | — |
| Perspective photo → measurement | ◐ via `/design` copy | — | ◐ 4-corner homography, no camera model | — | ● two-point camera solve | ● horizon-ratio stamp scaling |
| Voice / transcription | ● Whisper (flat text) | ◐ consumes Upright segments two ways | ● AssemblyAI with speakers | ● Web Speech API | — | — |
| Claude calls | ● 4 sites, `claude-sonnet-5`, server | ● 1 site, `claude-opus-5`, zod | ● proposal helper, `claude-opus-5`, edge fn | ● 5 sites, `claude-haiku-4-5-20251001`, **browser** | — | — |
| Offline persistence | ◐ `usePersistentState` UI prefs only | ● op-log queue + SW | ◐ audio outbox only (since 31 Aug) | ● IndexedDB + localStorage dual store | ◐ one form snapshot | ● IndexedDB project |
| Calendar / week view | ● calendar + planner | — | — | ● week calendar | — | — |
| Search / command palette | ● `CommandPalette` | — | — | ● Quick Find | — | — |
| Share / export | ◐ server ZIP (fflate) | — | ● client ZIP (JSZip CDN) + share sheet | ● JSON export | ● share sheet with proper cancel handling | ● JSON |

---

## 4. Code duplication, by domain

### 4.1 Two estimators

These are different designs solving the same problem, not a fork. MasterDash is canonical (4× the code, daily commits, its README calls VoiceData's table "legacy" at `README.md:3661`). VoiceData's `/estimator` is a port of an older Vite SPA (`docs/estimator-integration-plan.md`), last touched 2026-08-26, **still in the nav (`NavBar.tsx:9`) and still writing `Sales Board.value`** (`api/estimator/estimates/[id]/route.ts:76-80`).

Where they disagree on the same rows and same catalog:

| Concern | MasterDash | VoiceData | Effect |
|---|---|---|---|
| Estimate table | `quick_estimates` + `quick_estimate_taps` op log, `deal_id` nullable non-unique | `estimates`, `deal_id` UNIQUE | A deal can hold one of each; neither app shows the other's |
| What `total` means | sum of marked-up sell (`proposal.ts:273`), no tax | subtotal + tax (`useEstimate.js:863`), no markup | Incomparable numbers flow into one `Sales Board.value` column |
| Quantity rounding | `Math.ceil` to `round_to` (`assemblies.ts:113-116`) | `Math.round` (`useEstimate.js:178`) | 5.2 t → 6 vs 5 |
| Delivery loads | `Math.round` (`proposal.ts:224`) | `Math.ceil` (`useEstimate.js:796`) | opposite direction from the quantity rounding, in each app |
| Bucket / load step | `Math.floor(workPerLoad)` with worked example (`assemblies.ts:91`) | no bucket concept | — |
| `plan` jsonb | lat/lng node pool, shared corners (`plan.ts:87-111`) | image pixels + `pixelsPerFoot` | Same column name, unrelated coordinate spaces |
| `plan_image_path` | bytes only in `estimate-plans/<clientId>/…` | nulled when deal-linked; real image is a `deal_photos` row typed `Site_Plan_Image` (`plan-image/route.ts:61-89`) | Silent trap for any third reader |
| Photo links | embedded in the estimate JSON (`photoLink.ts:31-38`), Upright sessions as source | join table `estimate_photo_links` → `deal_photos` | VoiceData's schema is better; MasterDash's is the only one that works offline |
| Catalog access | committed snapshot (`catalog-data.ts`, regenerated by `scripts/sync-catalog.mjs`) + live price overlay | live query every load | MasterDash lags on new items; VoiceData has no offline story |
| Field names for identical `materials` columns | `increment`/`soldByLoad`/`autoDelivery`/`costPerUnit` (`types.ts:28-35`) | `unitsPerLoad`/`deliveryFee`/`unitPrice` (`catalogTypes.ts:16-22`) | blocks a shared type |
| Master photo key | `entity_type:entity_id` (`catalogPhotos.ts:6-8`) | same (`masterPhotos.ts:19-21`) | identical convention, two implementations — the one clean extraction |

### 4.2 Survey and elevation maths: three implementations, two models

- **Upright(main)** `index.html:7433-7453` (`elevationOf`), `8165-8182` (`slopeOf`) is the definition: `d_t·tan(θ_t) − d_a·tan(θ_a)`, mean of per-observation means, separate `repeat` and `agree` figures.
- **MasterDash** `lib/estimator/survey.ts:113-158,198-226` is a declared port and matches term for term, except: distance is WGS84 tangent-plane not haversine (`README.md:2508-2511`, ≤0.019 ft), the `hidden` check at Upright `:8168` is **not ported**, and the claimed pinning test does not exist (`package.json:9-15`, no `test:survey`).
- **Elevation** `src/core/SiteSurvey.js:337-372` uses a different model: solve instrument height from a curb sighting declared level with the observer, then absolute elevations. Single observation only, so no cross-check figure. Fixed five-point schema.

Timeline correction that matters for the game plan: Elevation was written 2026-08-30 and cites Upright as prior art (`SiteSurvey.js:6-7`). Upright `main` had already shipped the same inversion (`d = h/tan θ` at `index.html:7644-7652`, `measuredEyeHeightFt` at `:7653-7674`, the parked-pin circularity guard at `:7676-7679`) on 08-25 and typed shoot orders (`OBJ_TYPES`, `:8624-8656`) on 08-26, then moved on to sections, a Delaunay surface and drainage. **Elevation's survey half re-derives ground Upright already covered.** Its one unique asset is the two-point camera solve (`PerspectiveCalibration.js`, `PerspectiveProjection.js`, `ElevationModel.js`), which Upright approximates with a hand-dragged homography and no camera model (`index.html:9889-9905`).

Tilt sensing is duplicated with different tuning: Upright `STEADY_DEG=1.2, DWELL_MS=1400, REARM_DEG=2.5`; Elevation `0.6, 900, 1.5` (`SightView.js:28-32`). Elevation's `PostureGate` (`SiteSurvey.js:123-161`) and `capture()` that consumes its samples (`TiltSensor.js:145-154`) are the better-factored versions; Upright's are inline in a DOM handler.

Known unfixed Upright bug, diagnosed from MasterDash (`lib/estimator/review.ts:25-28`) and confirmed on `main`: clip export scales wall-clock offsets by audio drift (`index.html:5701-5724`) but playback compares them raw (`:5833,5873`), so a late clip exports aligned and plays out.

### 4.3 Geo, maps and tiles

**Earth models in use for the same yards:**

| Where | metres/degree | Formula |
|---|---|---|
| `Upright(main)/index.html:6872` | lat **110540**, lng 111320·cos | flat |
| `Upright(main)/index.html:7107,7563,7570,8946,9377,9381,11318` | **111320** both axes (8 copies) | flat |
| `Elevation/src/core/Geo.js:23` | π·6371008.8/180 ≈ 111195 | sphere |
| `VoiceData/src/lib/geocode.ts:40-51` | R = 6371000 | haversine |
| `MasterDash/lib/estimator/geo.ts:81-105` | 111057 / 83753 at 41°N | WGS84 ellipsoid |

MasterDash already documents the disagreement (`geo.ts:180-186`: ~7 cm over a 30 m plan). Upright's haversine (`:6861-6866`) lacks the `min(1,…)` clamp both others have. Upright's shoelace anchors at vertex 0 (`:6868-6879`), the bug MasterDash's comment at `geo.ts:126-129` says it fixed by anchoring at the centroid.

**Web Mercator** is implemented five times: `MasterDash/lib/estimator/geo.ts:55-69` (clamped), `MasterDash/components/estimator/JobBoard.tsx:57-58` (unclamped, inline), `Upright(main)/index.html:4554-4561` (`tileXY`, for the past-sessions mosaic, called twice per point at `:4573`), plus Leaflet's own in Upright, Elevation and VoiceData.

**The Esri tile URL** is hardcoded in four places (`Upright(main):10989`, `Elevation/SiteMapView.js:39`, `MasterDash/tiles.ts:26`, `MasterDash/JobBoard.tsx:68`) with the row/column order re-derived each time. VoiceData's two maps use OpenStreetMap raster instead, so the office app is the one without satellite.

**Past-sessions-as-tiles** (`Upright(main):4536-4590`) and **JobBoard's yard mosaic** (`JobBoard.tsx:53-75`) are near-verbatim re-implementations of each other: same URL, same 256 px mosaic, same east-west wrap, same lazy-load rationale.

`parseFeet` is an acknowledged copy (`MasterDash/geo.ts:358-359`: "Lifted from Upright"). `FEET_PER_METRE` is declared identically in `geo.ts:41` and `Geo.js:20`; Upright uses the inverse.

### 4.4 Plan georeferencing

All three store the same five numbers (centre lat/lng, width m, aspect, rotation) but:

| | Upright | MasterDash | Elevation |
|---|---|---|---|
| Home | `upright_sessions.plan_*` (one per session) | `property_map_layers` (many per property, z-order, lock, `source`) | transient view state |
| Corner projection | flat 111320 (`index.html:11318`) | WGS84 (`geo.ts:210-226`) | IUGG sphere (`Geo.js:96-114`) |
| Rotation sign | anticlockwise | anticlockwise, chosen to match Upright (`geo.ts:193-200`) | **clockwise** (`Geo.js:88-95`) |
| Width unit | metres | metres | **feet** (`SiteMapView.js:34`) |
| Inverse (corners → georef) | — | `cornersGeoref` (`geo.ts:231-267`) | — |
| Scale from known dimension | `applyKnownDimension` (`index.html:4168-4185`) | `scaleToKnownDimension` (`geo.ts:398-416`) | slider only |

An Elevation overlay pasted into either other app comes out mirrored in rotation. Nothing converts between the two persisted homes; VoiceData reads `plan_center_lat/lng` a third time purely as a property centroid (`uprightImport.ts:37-38,101`). `MasterDash/supabase/migrations/20260828_property_map_layers.sql:57-60` says Upright reads this table through `upright-api`; it does not (no reference on `main`).

### 4.5 Photo, video, annotation, export

- **Camera constraints:** four different requests. Upright uses a bare `facingMode:'environment'` string (hard constraint, can throw) at `index.html` where the others use `{ideal}`.
- **JPEG policy:** long-edge caps of 1024 (MasterDash `photos.ts:24`), 1800 (VoiceData `compressImage.ts:25`), 4096 (Elevation export), uncapped (Upright); quality 0.72 → 0.94 across ten call sites. The downscale body in `compressImage.ts:30-44` and `photos.ts:116-132` is the same code; VoiceData's has two guards MasterDash lacks.
- **EXIF/GPS:** only VoiceData reads EXIF (`clientExif.ts`, and correctly notes it must run before compression). Upright stamps live GPS instead. MasterDash and Elevation record no location with photos.
- **Video:** Upright caps H.264 at 2.5 Mbps (`index.html:2415`) and remuxes with ffmpeg.wasm; VoiceData re-encodes with mediabunny at 0.3–8 Mbps (`compressVideo.ts:18-29`). Two codec ladders, 3.2× apart on bitrate, same H.264-first reasoning. The `isTypeSupported` MIME walk and the `.includes('mp4')` extension test are duplicated ~9 times.
- **Annotation:** four editors, three technologies (canvas 2D ×3, Konva ×1). Upright alone has two with no shared stroke model, and both flatten into the JPEG. VoiceData and PerspectivePhoto pin identical Konva versions but VoiceData's annotator does not use Konva. Nothing stores annotations as editable vectors.
- **Share/export:** Upright now handles `AbortError` on the share sheet (`index.html:5762-5768`) but its ZIP (`:4251`) and pin-photo (`:6597`) paths are bare downloads. Elevation's `ExportManager.js:172-196` is the complete ladder. Two ZIP libraries (JSZip from CDN in Upright, fflate in VoiceData).

### 4.6 The PerspectivePhoto fork

`VoiceData/src/components/design/` is a copy of `PerspectivePhoto/src/`. All seven `engine/*.ts` files and `types/index.ts` are byte-identical; `useProjectStore.ts` differs by 58 lines (persistence moved to `projectPersistence.ts`); `useCustomStampStore.ts` has diverged substantially (Supabase library instead of IndexedDB); `Toolbar.tsx` adds a jobsite-photo picker and help panel. PerspectivePhoto has not been committed since 08-08; VoiceData's copy is the live one. A bug fix in either is invisible to the other, and they compile under TypeScript 6 and 5 respectively.

### 4.7 Data layer

**Client construction, four ways:** MasterDash hand-rolls `fetch` against `/rest/v1` with no SDK and four env-name fallbacks (`lib/server/supabase.ts:13-26`); VoiceData uses one `supabase-js` singleton for server and browser (`supabaseClient.ts:15-20`), so the anon key ships in the bundle even though it has zero grants; Upright's edge function uses `supabase-js` in Deno; Upright's page hardcodes the anon JWT (`index.html:2122` region) by design. MasterDash sends its **service-role key** as the bearer to `upright-api` when no anon key is configured (`lib/server/upright.ts:46`).

**Tables written by more than one app:** `Sales Board` (VoiceData everything, MasterDash `board_order` and read), `deal_photos` (VoiceData ~15 routes, MasterDash PATCHes GPS/outlier), `master_photos`, `plants` (MasterDash writes a full URL into `plants.image`; VoiceData writes a bare filename; `plants.ts:16-21` handles both), `materials`/`equipment`/`aspire_catalog` (VoiceData writes, MasterDash reads), `upright_sessions`/`upright_photos` (Upright via edge fn, VoiceData direct), `quick_estimates` (MasterDash writes, Upright edge fn reads).

**Buckets:** `estimate-plans` has two path conventions in one bucket (`<clientId>/<imageId>.ext` vs `estimate-<id>/<ts>-<uuid>.ext`), safe by coincidence. The public-URL builder string is duplicated ten times. Upright learned that replacing an object must land on a **new path** because the CDN caches (`upright-api/index.ts:136-146`); MasterDash's shared helper sets `x-upsert: true` unconditionally (`lib/server/supabase.ts:121`) and `plan-image` writes stable paths, which is exactly that bug.

**Auth, four trust models against one database:** cookie password that **fails open** if `SESSION_TOKEN` is unset (`VoiceData/src/middleware.ts:20`); nothing (MasterDash); public anon key to an edge function with no per-user authorization (Upright); shared bearer for VoiceMap sync. VoiceData's `/api/tables/[table]/rows` is generic read/write over every table behind the one password.

**Env vars:** only VoiceData has `.env.example`. MasterDash resolves the service key from four names and has a `configReport()` diagnostic precisely because there is no template.

### 4.8 AI and transcripts

| | Model | Where the key lives | Prompt style | Error handling |
|---|---|---|---|---|
| VoiceData ×4 (`agent.ts`, `analyzeTask.ts`, `voicemapWiki.ts`, `voicemap/ask`) | `claude-sonnet-5` | server | hand-written JSON-Schema tools, forced tool choice | mostly none; `analyzeTask` has no try/catch |
| MasterDash `visit-extract` | `claude-opus-5` | server, pre-flighted | zod structured output, adaptive thinking, server-side fallback beta | typed 429/502/504/422 — best in fleet |
| Upright(main) `proposal.ts` | `claude-opus-5` | edge fn secret, **prefix logged at boot** | evidence-checked JSON (every line carries a verbatim quote validated against the transcript) | good |
| VoiceMap ×5 | `claude-haiku-4-5-20251001` | **browser**, user-pasted, `localStorage`, prefix logged per call | assistant prefill `{` | manual |

Three model ids, two SDK majors, no shared constant; VoiceData repeats its `const MODEL` in four files.

Transcripts do not interoperate: `upright_transcript_segments` (structured, ms offsets, speakers) vs `deal_transcripts.transcript` (opaque TEXT) with **no importer between them** — `uprightImport.ts` bridges photos and calendar events only. MasterDash reads the segments in two shapes with two field-naming conventions (`transcriptText()` prose for the LLM at `upright.ts:174-190`; `timedSegments()` camelCase for the playhead at `transcript/route.ts:54-73`). MasterDash's `visit-extract` and Upright's `proposal.ts` now both run an LLM over the same Upright transcript for adjacent purposes.

### 4.9 Offline and persistence: five strategies

| App | Store | Merge | Retry |
|---|---|---|---|
| MasterDash | localStorage queue + op log, SW cache | union of ops, pull-then-push, client-minted ids, refused-vs-unreachable distinction (`sync.ts:53-65`) | yes, at cycle rate, no backoff |
| VoiceMap | IndexedDB + localStorage dual write | session-level last-writer-wins with a one-sided rescue (`index.html:7255-7263`) | none; `pullFromCloud` swallows into `catch {}` |
| Upright(main) | IndexedDB outbox **for audio only** (`index.html:2214`), 4 attempts at 0/2/4/8 s | server is authority | audio only; clips, pins, sketches still fire-and-forget |
| PerspectivePhoto / VoiceData design | IndexedDB project / Supabase jsonb + Storage | last write wins | none; an offline save is lost |
| VoiceData UI | `usePersistentState` | n/a | n/a |

MasterDash's is the only one that has been debugged against a real failure (`sw.js:60-79` opaque-response trap, covered by `test-sw.mjs`). Its queue/lifecycle/ids layers generalise; its op-log merge does not (it depends on taps being commutative increments).

### 4.10 Integration graph

```
                Supabase ktgpjizfntdfpghalukx
        ┌──────────────┬──────────────┬───────────────┐
        │              │              │               │
   VoiceData      MasterDash     upright-api     (MindMap repo,
   service key    service key    edge fn         agent-ops, …)
   PostgREST      raw REST       service key
        │              │              │
        │   board_order│ (MD writes,  │ reads quick_estimates
        │   VD reads)  │  VD reads)   │ directly  ◄── NEW, §0 #8
        │              │              │
        │              └── /sessions, /survey, /transcript ──►│
        │                  (MD → edge fn only, on principle)  │
        │                                                     │
        ├── reads upright_sessions/photos DIRECTLY ───────────┤  (VD, against Upright's rule)
        │                                                     │
        ◄── POST /api/voicemap/sync ── VoiceMap (bearer token) │
        │                                                     │
        └── vendored copy of PerspectivePhoto/src              Upright index.html
                                                              (anon key → edge fn)

   Elevation: no integration with anything.
   Hyperlinks between deployed apps: none.
```

---

## 5. UI inconsistencies

### 5.1 Tokens

| Token | MasterDash | VoiceData | Upright | VoiceMap | Elevation | PerspectivePhoto |
|---|---|---|---|---|---|---|
| Theme | dark only, by argument (`globals.css:3-7`) | light + dark in **9 separate files** | dark only | light only | dark only | light only |
| Accent | `#22c55e` green | `#1F6F6D` teal — but `#16a34a` green in Settings, Tables, Agent-ops | `#c4432b` rust | `#E24B4A` red (+ iOS blue `#007aff` in Quick Find) | `#8fe9ff` cyan | Tailwind `blue-500` |
| Tile radius | 24 px | 14 px launcher, 12 px deal tile | — | 16 px | 12 px | 8 px |
| Tile min column | `clamp(8rem,15.2vw,13rem)` | 300 px launcher, 220 px deals, 190 px photos | — | 150 px | — | — |
| Tile aspect | square | square, **except deal tiles 16:10** | — | square | — | — |
| Badge | top-right, white | bottom-right, dark | — | top-left, outside the tile | — | — |
| Modal scrim | `black/70` | 0.5, 0.6, 0.62, `black/40`, `black/50` (five values) | none (full-screen panels) | 0.5 + blur | — | — |
| Long-press | 500 ms ×3 | 500 ms tile, **550 ms card, same screen** | — | 500 ms | — | — |
| Touch target | none stated; header buttons 26–32 px | none; nav pills 30 px | none; icon buttons 28 px, **22 px in split screen** (`main:145-150`) | none; collapse button **16 px** | **`--tap: 44px`** | none |
| Safe areas | `.md-safe` class | none except camera | inline `env()` ×5 | `--safe-top/bottom` tokens | inline `max()` | none |
| Viewport | `maximumScale:1`, landscape lock | **no viewport export at all** (pinch-zoom on, no `viewport-fit`) | `maximum-scale=1, viewport-fit=cover` | `maximum-scale=1` | `any` | `user-scalable=no`, no `viewport-fit` |
| Font stack | system | system + Geist in Tailwind components | system | system | system, **15px/1.45 base** | system |
| PWA | manifest + SW, SVG-only icon (will not install on iOS) | **nothing** | icons + apple-touch-icon, no manifest/SW | ATHS meta + `BUILD_TS`, anti-cache | manifest + PNG icons, no SW | ATHS meta only |

VoiceData's 25-token palette is pasted verbatim into seven CSS modules plus twice more inside `sales-board.module.css`; the launcher renames them `--tl-*` with identical values.

### 5.2 Patterns each app re-implements

| Pattern | Implementations | Standardise on |
|---|---|---|
| Top nav / home | MasterDash breadcrumb header; VoiceData 17-pill scrolling NavBar **or** a floating "Launch Pad" FAB in tile mode; VoiceMap iOS nav bar; Upright none | VoiceMap's `.nav-bar` structure (`index.html:49-83`) — only one with safe-area padding and a back target — in MasterDash's palette |
| Tile grid | MasterDash TileGrid + JobBoard (byte-identical tile markup, pinned by `tileSize.ts`); VoiceData launcher, deal tiles, photo grid; VoiceMap root grid | MasterDash: only `clamp()` sizing that survives portrait/landscape/desk; photo-under-scrim; documented rationale |
| Modal / sheet | `.modal-overlay` written **four times** in VoiceData with different alignment (two components with identical class names resolve to different CSS); MasterDash centred; VoiceMap bottom sheets; Upright full-screen panels | VoiceMap bottom sheet for ≤3 fields (only family with `safe-area-inset-bottom`); VoiceData's `.is-fullscreen` forced-dark deal modal for forms |
| Toast | three copies in VoiceData (one drifted), VoiceMap, none in MasterDash | VoiceMap's (safe-area offset, backdrop blur) |
| Shutter | Upright 76 px opaque rust ring; VoiceData 64 px `bg-white/30` (low contrast in sun); VoiceMap 44 px file input | Upright's `.snap-btn` |
| Photo rail | Upright **two sizes in one file** (172×128, 192×144); MasterDash 80×80 square with the best argument in the fleet (`ReviewPanel.tsx:591-604`) | MasterDash square, at Upright's size |
| Record button | VoiceData neutral→red; VoiceMap **red idle → black recording**; Upright pulsing header dot | VoiceMap geometry + glow, VoiceData semantics, Upright pill as secondary |
| Kanban | VoiceData 378 px columns; VoiceMap 240 px with collapse-to-44 px vertical label; MasterDash one stage per page, never scrolls | MasterDash for iPad one-handed; steal VoiceMap's collapse |
| Calendar | VoiceData `--hour-height` variable; VoiceMap hard-coded positions and **9 px type** | VoiceData's mechanism |
| Command palette | VoiceData (grouping, kbd legend, states); VoiceMap Quick Find (blur, safe-area top, larger radius, off-palette blue) | VoiceData's function, VoiceMap's look |
| Drag reorder | dnd-kit (VoiceData legacy estimator only) + hand-rolled clone-ghost in VoiceData sales board **and** VoiceMap (near-identical) + MasterDash FLIP slot maths; five ghost styles in VoiceMap alone | MasterDash FLIP; drop dnd-kit with the legacy estimator |
| iOS ghost-click | three windows in VoiceMap (300/?/400 ms), boolean refs in VoiceData, pointer-events-only in MasterDash | MasterDash: never attach `onClick` |
| Swipe actions | VoiceMap only | — |

---

## 6. Where the architecture can be improved

### 6.1 Target shape

A **monorepo** (`rlm/`) with the six apps as workspaces and a `packages/` tree. Not because monorepos are good in general, but because every finding above is a case of two repos re-deriving the same thing with no way to see each other. The agent, and the user, need one place to look.

```
rlm/
  apps/
    office/        ← VoiceData
    estimator/     ← MasterDash
    upright/       ← Upright (still single-file; that is fine)
    voicemap/
    elevation/     ← or archived, see 7.2
    perspective/   ← PerspectivePhoto, or deleted in favour of office/design
  packages/
    schema/        ← supabase/migrations + generated types   (§4.7, §2.4)
    supabase/      ← one server client, env resolution, storage paths + URL builder, "new path never upsert"
    geo/           ← WGS84 tangent frame, haversine (clamped, one radius), area (centroid-anchored), parseFeet
    georef/        ← the five numbers, corners↔georef, known-dimension scaling, one rotation sign
    survey/        ← elevationOf / slopeOf / instrumentHeight / tilt gates, with the fixture test both repos claim
    tiles/         ← Esri template, attribution, zoom clamps, Leaflet layer + canvas mosaic
    capture/       ← camera constraints, image profiles (thumb/field/archive), EXIF-before-compress, MIME probe
    offline/       ← queue, lifecycle, ids, backoff (from MasterDash sync.ts), pluggable store
    ai/            ← MODEL constants, one Anthropic client, typed error mapping (from MasterDash visit-extract)
    ui/            ← tokens.css + Tile, TileGrid, Sheet, Toast, Shutter, PhotoRail, NavBar, useLongPress
    design-engine/ ← the seven byte-identical PerspectivePhoto engine files
```

Upright and VoiceMap can consume packages as a build step that inlines them (Elevation's `tools/build.mjs` already does exactly this for a single-file target), so "single file, no build" stays true for the deployed artefact.

### 6.2 What should NOT be shared

- The two `PlanCanvas` files. Different coordinate systems; nothing to merge. Retire VoiceData's.
- MasterDash's op-log merge. It is specific to commutative taps.
- The three annotation editors as components. Share a **stroke document format**, not an editor.
- `CatalogItem` types. MasterDash's is strict and tile-oriented; VoiceData's is an open bag. Unify at the DB row level (`packages/schema`), not the app level.
- Transcript flatteners. MasterDash's two are correctly specialised.

### 6.3 Access convention: pick one

Three exist. The defensible choice is **the edge function owns `upright_*`, PostgREST-with-service-key owns everything else, and any cross-app read goes through the owning app's API or a database view**. Concretely: Upright's `/takeoff` should read a `quick_takeoffs` view MasterDash publishes, not `quick_estimates.lines` raw; VoiceData's `uprightImport` should call `GET /sessions` on `upright-api` like MasterDash does.

---

## 7. Game plan

Ordered by risk removed per day of work. Each phase is independently shippable. Nothing in Phase 0 needs the monorepo.

### Phase 0 — Stop the bleeding (this week, no refactors)

1. **Decide the estimator question (§0 #1).** Either remove `/estimator` from `VoiceData/src/components/NavBar.tsx:9` and make its routes read-only, or make both apps display the other's estimate on the deal. Until then, two engines write `Sales Board.value`.
2. **Put MasterDash behind a gate.** Vercel password protection today (its README suggests it at `README.md:3850`), a copy of VoiceData's cookie middleware next. And make VoiceData's middleware fail **closed** when `SESSION_TOKEN` is unset (`src/middleware.ts:20`).
3. **Enable RLS on `plaud_processed`** (§2.5).
4. **Remove the two key-prefix log lines** (`VoiceMap/index.html:4144`, `Upright(main)/supabase/functions/upright-api/index.ts:89-91`).
5. **Make MasterDash CI run MasterDash's tests** (`.github/workflows/ci.yml:26-36`, one step).
6. **Create `main` in VoiceData and PerspectivePhoto**, point Vercel production at it, and delete the ~25 dead `claude/*` branches. Fix `PerspectivePhoto/.github/workflows/deploy.yml:6`.
7. **Dump the schema into git.** `supabase db dump` into `VoiceData/supabase/migrations/0000_baseline.sql` plus `generate_typescript_types` output. This is the prerequisite for every shared type.
8. **Add hyperlinks between the apps.** A row of six tiles on VoiceData's Launch Pad and a "Back to office" link in each app's header. Cheapest visible fix in the audit.
9. **Write the survey fixture test both repos claim.** Use Upright's `test62.js:5-6` technique to pull `elevationOf`/`slopeOf` out of `index.html` and run them beside MasterDash's `survey.ts` on one three-observation fixture. Fix the `hidden` omission while there.
10. **Upright outbox for everything, not just audio.** Extend the IndexedDB outbox at `index.html:2214` to clips, pins, sketches, measures, points, shots.

### Phase 1 — Foundations (weeks 2–3)

11. Monorepo scaffold with the six apps moved in as-is (git history preserved with `git subtree` or `filter-repo`). No behaviour change; CI runs every repo's existing checks.
12. `packages/schema` from the Phase 0 dump; replace hand-written `DealRow`/`PhotoRow`/`UprightSessionRow` types in MasterDash and VoiceData with generated ones.
13. `packages/supabase`: one server client (SDK, with MasterDash's multi-name env resolution and `configReport()` kept), one storage-URL builder, one "replace onto a new path" upload helper. Fix MasterDash's unconditional `x-upsert`.
14. `packages/geo` + `packages/georef` (~250 lines total, taken from `MasterDash/lib/estimator/geo.ts`). Replace Upright's nine flat-earth sites and Elevation's clockwise corners. Georef first: it is the only item with a live cross-app sign bug.
15. `packages/ai`: `MODELS` constant, one client, MasterDash's typed error mapping. Route VoiceMap's five browser calls through VoiceData (the sync token, CORS and middleware exemption already exist), which removes the client-side key entirely.

### Phase 2 — Field data (weeks 3–5)

16. `packages/offline` from `MasterDash/lib/estimator/sync.ts` (queue, lifecycle, ids, plus the backoff none of the apps has). Consumers in order: Upright (replaces the audio-only outbox), VoiceMap (replaces `catch {}`), VoiceData design autosave.
17. `packages/survey`: move `elevationOf`/`slopeOf`/tilt gates in, with Elevation's `PostureGate` and sample-consuming `capture()` as the reference implementations. Or, the alternative both repos name: a derived `/survey/:id/elevations` endpoint on `upright-api`, and MasterDash stops mirroring.
18. Transcript bridge: an importer from `upright_transcript_segments` to `deal_transcripts` (or make `deal_transcripts` reference the session), so a visit's words reach the deal without copy-paste.
19. Fix the Upright drift-scaling playback bug (`index.html:5833,5873`) using MasterDash's `driftScale` as the reference.
20. Move the Upright↔MasterDash take-off contract onto a view or endpoint (§6.3).

### Phase 3 — UI system (weeks 5–8, can run in parallel with Phase 2)

21. `packages/ui/tokens.css`, dark-first from MasterDash's `globals.css:10-16`, with Elevation's `--tap: 44px`, VoiceMap's `--safe-*` tokens, Upright's `--live` recording colour kept distinct from the accent. Collapse VoiceData's nine palettes onto it and reconcile its green/teal split.
22. Components in payoff order: `Tile`+`TileGrid`, `Sheet`, `useLongPress`, `Toast`, `Shutter`/`RecordButton`, `PhotoRail`, `NavBar`, `useDragReorder`.
23. VoiceData gets a `viewport` export (`viewportFit:"cover"`, `maximumScale:1`), `appleWebApp` metadata, MasterDash's `sw.js` and a manifest. Same for Upright and Elevation. MasterDash gets PNG icons following Elevation's `index.html:11-14` comment.
24. Raise every sub-44 px control named in §5.1.

### Phase 4 — Consolidate the prototypes (when convenient)

25. **Elevation:** lift `PerspectiveCalibration.js` / `PerspectiveProjection.js` / `ElevationModel.js` into `packages/survey` (or into Upright's elevation view, which has the homography but no camera model) and archive the rest. Its survey half is a re-derivation of Upright 08-25.
26. **PerspectivePhoto:** the VoiceData copy is the live one. Extract `packages/design-engine` from the seven identical files, delete the standalone repo or make it a thin shell over the package.
27. **VoiceData legacy estimator:** delete after Phase 0 step 1, along with the three `@dnd-kit` packages it alone uses.
28. Retire the two unlinked legacy Upright Vercel projects.

### 7.1 Decisions only the owner can make

- Which estimator survives (or both, with mutual visibility).
- Whether Elevation is a product or a donor.
- Whether VoiceMap keeps its own Claude key or goes through VoiceData (recommended).
- Monorepo, or shared packages published from one repo. The recommendation is monorepo, because the agent context problem (§2.1) is the root cause of most of this document.
- One accent colour. Green (MasterDash) is proposed because it already exists in three of the six apps.

### 7.2 What this audit did not do

- Run any app. Findings are static reads plus live Supabase/Vercel/GitHub metadata.
- Read the MindMap or HomeSchool repos, which share the database but were out of scope.
- Verify field behaviour of anything marked "needs field testing" in the apps' own docs.

---

## Appendix A — Table ownership (live schema, 87 tables)

| Owner | Tables |
|---|---|
| VoiceData only (~45) | `action_history`, `deal_attachments`, `deal_correspondence`, `deal_stage_history`, `deal_transcripts`, `tasks`, `task_photos`, `contacts`, `events`, `estimates`, `estimate_photo_links`, `estimator_settings`, `materials`, `equipment`, `applications`, `assemblies`, `assembly_roles`, `assembly_equipment`, `sequence_stages`, `stage_*`, `master_photos`, `aspire_catalog`, `plants`, `plant_combinations`, `plant_combination_plants`, `planning_blocks`, `planning_placements`, `stage_effort_defaults`, `sms_templates`, `emails`, `app_settings`, `voicemap_*` (5), `voicedata_tables`, `voicedata_rows`, `pp_library_items`, `pp_projects`, `agent_*` (8), `apps`, `app_documents`, `site_visit_*` (3), `crew_locations`, `neighborhoods`, `plaud_processed` |
| MasterDash only | `quick_estimates`, `quick_estimate_taps`, `quick_synthetic_items`, `quick_catalog_overrides`, `quick_tiles`, `property_map_layers` |
| Upright only (via edge fn) | `upright_sessions`, `upright_clips`, `upright_photos`, `upright_sketches`, `upright_measures`, `upright_transcript_segments`, `upright_elevation_points`, `upright_elevation_shots`, `upright_elevation_slopes`, `upright_elevation_views`, `upright_elevation_sketches`, `upright_objects`, `upright_catalog_items`, `upright_proposal_items` |
| Written by two apps | `Sales Board`, `properties`, `deal_photos`, `master_photos`, `plants`, `upright_sessions`, `upright_photos` |
| Read cross-app without an API | `quick_estimates` (by upright-api), `upright_sessions`/`upright_photos` (by VoiceData), `materials`/`equipment`/`aspire_catalog` (by MasterDash) |
| No code in these six repos | `mindmap_canvases`, `mindmap_nodes`, `mindmap_edges`, `mindmap_images` |

## Appendix B — Environment variables

| Variable | MasterDash | VoiceData | Upright edge fn |
|---|---|---|---|
| Supabase URL | `SUPABASE_URL` → `SUPABASE_PROJECT_URL` → `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_URL` |
| Service key | `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SERVICE_KEY` → `SUPABASE_SECRET_KEY` → `SUPABASE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| Anon key | `UPRIGHT_API_KEY` → `SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `SUPABASE_PUBLISHABLE_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` |
| Other | `NEXT_PUBLIC_QE_SAVE_URL`, `NEXT_PUBLIC_QE_PHOTO_UPLOAD_URL` | `OPENAI_API_KEY`, `APP_PASSWORD`, `SESSION_TOKEN`, `VOICEMAP_SYNC_TOKEN`, `EMAIL_INBOUND_TOKEN`, 17× `ASPIRE_*` | `ASSEMBLYAI_API_KEY` |

Only VoiceData has an `.env.example`.
