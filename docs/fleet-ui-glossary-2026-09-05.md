# Fleet UI glossary

**Date:** 2026-09-05. **Purpose:** one vocabulary for talking to a coding agent about any part of the six apps without describing the window each time. Every term carries the code identifier the agent should search for. Terms prefer the names the code and the apps' own docs already use; where two names circulate, both are listed and the preferred one is marked.

**Source of truth for Upright:** the `main` branch (2026-08-31), which is 66 commits ahead of some older `claude/*` branches. Line numbers for Upright are against that `index.html` and `CLAUDE.md`.

---

## How to name a thing

Say it as a path, most general to most specific, and add the code identifier in parentheses when you know it:

> **App › Screen › Region › Control** — e.g. *VoiceData › Deal modal › Tools row › New design button* (`DealModal.tsx`, `styles["tool-btn"]`), or *Upright › Map view › Pin inspector › note field* (`#piBody`), or *MasterDash › Plan page › Side column › LAYERS card › Lock in place*.

Three words are overloaded across the fleet and need a qualifier every time: **tile**, **plan**, **stage**. The table below says which qualifier.

## Fleet-wide vocabulary

Words that mean the same thing in more than one app, or different things in different apps.

| Term | Canonical meaning | App-specific aliases and traps |
|---|---|---|
| **Deal** | One sales opportunity; a row of `"Sales Board"`. | VoiceData: *deal*. MasterDash: *job* on screen, `deal` in code. Say "Sales Board row" only when you mean the table. |
| **Property** | One address; `properties` row. Many deals over time share one property. | Also *jobsite*, *yard*. Upright tags a session to a property (*property match*). MasterDash's Plan page has a **PROPERTY card**. |
| **Contact** | The property's single primary contact (`contacts`). | A deal has no contact of its own. |
| **Event** | A block of time at a jobsite (`events`), auto-clustered from photo GPS + time or made by hand. | An imported Upright **session** becomes a *Consultation* event. Event types: Appointment, Consultation, Design, Estimating, Meeting, Job, EOM, Other. |
| **Session** | Depends on the app. | Upright: one site visit (`upright_sessions`) — the main meaning. VoiceMap: one brainstorm (a tree of cards). VoiceData: the login cookie, and the stored *Aspire session*. Say "Upright session" or "VoiceMap session". |
| **Photo pin** | Upright: a picture plus a GPS position, draggable on the map (`upright_photos`). | After import it is a `deal_photos` row typed `Property_Reference` referencing the `upright-media` bucket in place. Not the same as a MasterDash *dot* (a photo dropped on the plan). |
| **Estimate** | Two different things. | MasterDash **quick estimate** (`quick_estimates`, taps and buckets). VoiceData **legacy estimate** (`estimates`, rows and kits, at `/estimator`). Always say which. |
| **Take-off** | A measured bed or run that adds loads to an estimate. | MasterDash: `PlanShape` on the Plan page (the canonical one). Upright: the read-only **Take-off layer** drawing MasterDash's shapes on the site map. VoiceData legacy estimator: a **take-off group** row. |
| **Plan** | Overloaded five ways. | (1) MasterDash **Plan page** — the map take-off screen. (2) Upright **plan overlay** / **plan georef** — an imported drawing placed on satellite (`plan_*` columns). (3) Design tool **Plan view** — the 2-D symbol layout. (4) VoiceData **site plan image** — the estimator's saved image (`photo_type = Site_Plan_Image`). (5) Calendar **planning block** — a scheduling window. Qualify every time. |
| **Layer** | A georeferenced image over the satellite. | MasterDash: `property_map_layers`, edited on the **LAYERS card**. Upright: the equivalent is the *plan overlay* (one per session). Elevation: *overlay image* (transient). |
| **Anchor** | Conflicts. | Upright survey: the `0.00'` datum point every elevation is measured from (**anchor**, yellow). MasterDash Plan page: the locked home view of the map (**plan anchor**, padlock button). Say "survey anchor" or "plan anchor". |
| **Survey** | A relative elevation survey. | Upright: the whole feature (observation / anchor / targets / sets / slope runs). MasterDash: the **SURVEY card** that draws Upright's points under the take-off. Elevation: the **site survey** (five fixed points, curb assumption). |
| **Tile** | A square tappable picture. | VoiceData: **Launch Pad tile** (app), **stage tile**, **deal tile** (Sales Board Tiles view), **album tile** (Photos), **catalog tile**, **PM tile** (Planner). MasterDash: **job tile** (board), **estimate tile** (grid). VoiceMap: **root tile**. Upright: **session tile** (Past sessions as map tiles). |
| **Board** | A grid or column layout of deals. | VoiceData **Sales Board** (kanban). MasterDash **Job board** (one stage per page; writes `board_order`). VoiceData **Planner board** (Gantt). VoiceMap **Board** tab (its own kanban, not deals). |
| **Stage** | Pipeline stage: Lead → Propose → Sent → Sold → Project Management → Invoiced → Paid in Full. | Not the **estimating phase** (Master Catalog *Phases*, `ASSEMBLY_STAGES`). Not Upright's `#stage`, which is the camera container `<div>`. Not Elevation's `#stage`, the photo canvas. |
| **Card** | Depends on the app. | Sales Board **deal card** (kanban). VoiceMap **card** = a node/idea. MasterDash Plan page **side-column cards** (PROPERTY, SURVEY, LAYERS, PLANTING). Elevation control-panel **cards** (numbered steps). |
| **Filmstrip / photo rail** | A horizontal row of thumbnails. | Upright: **filmstrip** (map) and **photo rail** (review). MasterDash: **filmstrip** (Plan page, four switches: Visit / Property / Reference / Plants) and **photo rail** (Review). VoiceData: **photo strip** (deal modal footer; Next Actions row). |
| **Transcript** | Two incompatible stores. | Upright **transcript segments** (AssemblyAI, per utterance, speakers, ms offsets) shown in the review's **transcript rail**. VoiceData **deal transcript** (plain text on a deal, from Plaud). MasterDash reads Upright's. |
| **Next action** | The one task per deal flagged `is_next_action`. | Also the **Next Actions** screen, the **Action Photos** screen, and the ⚡ **next-action photo**. |
| **Kit / assembly** | A priced recipe. | MasterDash **assembly** (`assemblies.ts`, bucket maths). VoiceData legacy estimator **assembly kit** (saved take-off group). Master Catalog **assembly** (the DB row both read). |
| **Modal / sheet / panel** | A layer over the screen. | VoiceData: *modal* (`modal-overlay`). MasterDash: *sheet* (`TileOptionsSheet`). VoiceMap: *sheet* for bottom sheets, *modal* for centred ones. Upright: *panel* (full-screen `.history-panel`, `.review-panel`, `.done-panel`, `.settings-panel`) and *overlay* (`.stage-overlay`, `.sight-overlay`). |
| **Inspector** | Upright's fixed left column describing the selected pin (`#pinInspector`). | Called *preview column* in its Settings switch. MasterDash has no inspector; the nearest is the **side column**. |
| **HUD / overlay** | Text and controls drawn over a live camera or photo. | Upright **sighting overlay** (`#sightOverlay`), **outline HUD**. Elevation **step HUD**, **readout**, **sight view**. |

---

## VoiceData

Routes are Next.js App Router paths; file paths are relative to the VoiceData repo.

A screen-by-screen, region-by-region reference. All paths are repo-relative to the VoiceData repo.

---

### 0. Conventions used here

| Term | Code identifier | What it is |
|---|---|---|
| **Screen** | a `src/app/**/page.tsx` route | One route path. Server component usually just loads data and renders a `*Client.tsx`. |
| **Client** | `*Client.tsx` / `client.tsx` | The `"use client"` component that owns all interaction on a screen. Say "the Calendar client" to mean `src/app/calendar/CalendarClient.tsx`. |
| **Module CSS** | `<area>.module.css` | Per-screen stylesheet. Class names in it (e.g. `deal-section`, `column-head`) are the most stable region names in the app — prefer them when naming a region. |

---

### 1. Global / cross-screen elements

Everything below is mounted for every route by `src/app/layout.tsx`.

| Term | Code identifier | What it is |
|---|---|---|
| **NavBar** (preferred) / "top nav" | `NavBar` — `src/components/NavBar.tsx` | Sticky pill-link bar at the top. `NAV_ITEMS` holds the 17 labels + hrefs and is the canonical list of screen names. Hidden entirely when Tile mode is on. |
| **Sign out button** | last `<button>` in `src/components/NavBar.tsx` | Right-aligned; POSTs `/api/auth/logout`, then goes to `/login`. |
| **Launch Pad** (preferred) / "TileLauncher" / "tile mode home" | `TileLauncher` — `src/components/TileLauncher.tsx`, `src/components/tileLauncher.module.css` | Full-screen tile navigator that *replaces* the home page when Tile mode is on. Three levels: `home` (app tiles) → `stages` (pipeline stage tiles) → `deals` (deal tiles). |
| **Launch Pad tile** | `.tile` / `styles.tile` in `tileLauncher.module.css`; `MAIN_VIEWS` in `TileLauncher.tsx` | One big square button per app area (Sales Board, Estimator, Master Catalog, Design, Plants, Plant Reference, Next Actions, Action Photos, Tasks, Properties, Calendar, Planner, Photos, VoiceMap, Agent Ops, Settings). Disambiguate from *deal tile* and *plant tile*. |
| **Stage tile** | `screen.level === "stages"` branch, `TileLauncher.tsx` | One tile per pipeline stage, colored from `STAGE_COLOR`, badged with the deal count. |
| **Deal tile (Launch Pad)** | `StageDeals` — `TileLauncher.tsx` | Monogram square + value badge + 🚩 flag; opens `/sales-board?deal=<id>`. Not the same as the Sales Board **Tiles view** tile. |
| **Launch Pad breadcrumb / back** | `styles.back`, `styles.head`, `styles.title` — `tileLauncher.module.css` | "‹ Sales Board" / "‹ Launch Pad" header button. |
| **Tile Mode Home Button** | `TileModeHomeButton` — `src/components/TileModeHomeButton.tsx` | Floating bottom-**left** "⊞ Launch Pad" pill. Only rendered in Tile mode, and never on `/`. |
| **Command palette** | `CommandPalette` — `src/components/CommandPalette.tsx` | ⌘K / ⌘⇧K modal search over **Photo albums**, **Deals**, **Properties** (`GROUP_LABELS`). Groups appear in that order. |
| **Search FAB** | first `<button>` in `CommandPalette.tsx` (`fixed bottom-5 right-5`) | Magnifier circle that opens the palette. Bottom-right stack position 1. |
| **Palette footer hint** | last div in `CommandPalette.tsx` | "↵ open · ⌘↵ flag as loose end". |
| **Quick add task** | `QuickAddTask` — `src/components/QuickAddTask.tsx` | Bottom-right FAB at `bottom-20`. Voice-first: press, dictate a task, it parses and saves. Shows a toast bubble at `bottom-[7.75rem]`. |
| **Quick add event** | `QuickAddEvent` — `src/components/QuickAddEvent.tsx` | Green FAB at `bottom-[8.5rem]`, shortcut **⌥E**. Modal "Quick add event" with Title / Type / Start / End / Property typeahead / Deal chips / Notes. |
| **Camera capture** | `CameraCapture` — `src/components/CameraCapture.tsx` | FAB at `bottom-[12rem]` ("Photo + voice note"). Full-screen live camera, shutter ring, "● rec" dictation indicator, batch counter, then a **review sheet** (Property picker + per-photo caption rows). |
| **Video Snapshot** | `VideoSnapshot` — `src/components/VideoSnapshot.tsx` | FAB at `bottom-[15.5rem]`. Records a walkthrough video while grabbing stills; then a review sheet (video preview, snapshot strip, caption, property), then a **caption cycle** overlay (1/N, Mark up ✎, Dictate, Next). Videos are tagged `Video_Walkthrough`. |
| **Mic button** | `MicButton` — `src/components/MicButton.tsx` | Record → `/api/transcribe` (Whisper). Used on the home voice screen. |
| **Schema panel** ("Database" panel) | `SchemaPanel` — `src/components/SchemaPanel.tsx` | Right-hand list of SQLite tables + columns on the home screen. |
| **Photo Annotator** | `PhotoAnnotator` — `src/components/PhotoAnnotator.tsx`, `src/components/photoAnnotator.module.css` | Full-screen markup editor over a photo. Opened from the Calendar lightbox, Photos lightbox, and VideoSnapshot ("Mark up"). See §16 for its tools. |
| **Toast** | `styles.toast` / `styles["is-visible"]` in each module CSS | Bottom transient status strip. Present on Sales Board, Tasks, Next Actions, Properties (`import-toast`). |

**Bottom-right FAB stack, top to bottom:** Video Snapshot (15.5rem) → Camera capture (12rem) → Quick add event (8.5rem) → Quick add task (5rem/`bottom-20`) → Search (1.25rem/`bottom-5`).

---

### 2. Home / voice screen — `/`

| Term | Code identifier | What it is |
|---|---|---|
| **Home** / "voice UI" | `src/app/page.tsx` (`Home`) | Talk-to-build-a-database chat. If Tile mode is on this renders `TileLauncher` instead. |
| **Header** | `<header>` in `src/app/page.tsx` | "VoiceData" + "Talk to build a database on the fly." |
| **Transcript column** | `<section>` with the `turns.map` | Chat bubbles, user right / assistant left, plus a "Thinking…" line. |
| **Composer row** | the flex row holding `MicButton` + the `<form>` | Mic button, "…or type instead" input, Send. |
| **Database panel** | `<aside>` → `<h2>Database</h2>` → `SchemaPanel` | Live SQLite schema. |
| **Activity list** | `<h2>Activity</h2>` + `activity.slice(0,20)` | Monospace list of the last 20 tool calls; red when a call errored. |

---

### 3. Sales Board — `/sales-board`

**Screen:** `src/app/sales-board/page.tsx` (server) → `SalesBoardClient` — `src/app/sales-board/SalesBoardClient.tsx`. NavBar label: **Sales Board**. Styles: `src/app/sales-board/sales-board.module.css`. Purpose: Kanban deal pipeline backed by the Supabase `"Sales Board"` table.

#### 3.1 Chrome

| Term | Code identifier | What it is |
|---|---|---|
| **Topbar** | `styles.topbar` | Brand block + stats + view toggle. |
| **Brand mark** | `styles["brand-mark"]`, `styles["brand-row"]` | Bar-chart logo, "Sales Board", "Deals moving through the pipeline". |
| **View toggle** | `styles["view-toggle"]`, `styles["view-toggle-btn"]` | **Board** / **Tiles** / **Table**. Table is hidden on phones (`isPhone`), which fall back to Tiles. |
| **Descriptions toggle** | `styles["desc-toggle"]`, state `showDescriptions` | Shows the proposal description inline on each card. |
| **Next Action toggle** | second `desc-toggle` button, state `showNextAction` | Shows `deal.next_action` on each card. |
| **Refresh button** | `styles["refresh-btn"]` | Re-fetches `/api/sales-board`. |
| **Geocode backfill link** | `refresh-btn` linking `/admin/geocode-backfill` | Jump to the bulk geocoder. |
| **Stat tiles** | `styles.stat`, `styles["stat-value"]`, `styles["stat-label"]` | **Deals** (count), **Pipeline** (total value), **Paid in full** (`is-success`). |
| **Lost stat** | `styles["lost-stat"]` | Clickable stat; opens the Lost deals modal. |
| **Add bar** | `styles["add-bar"]`, `styles["new-deal-toggle"]` | "+ New deal" button. |
| **New deal form** | `styles["add-form"]` / `is-open` | Inline create form: Customer last name, Company, Value, Contact first/last/email/phone, Proposal #, RFP date, Proposal date, Won date, Appointment date, Production start day, Production stop day, Invoiced date, Paid in full date, Jobsite address (`PropertyPicker`), Proposal description. |

#### 3.2 Board view

| Term | Code identifier | What it is |
|---|---|---|
| **Board / board wrap** | `styles["board-wrap"]`, `styles.board` | Horizontally-scrolling column strip. `has-photo-pane` when the wide-screen preview pane is on. |
| **Stage column** | `styles.column`, `data-column`, `data-stage` | One per `STAGES` entry. Drop target for card drags. |
| **Column head** | `styles["column-head"]`, `column-head-top` | Collapse chevron, color dot, title, count. |
| **Column collapse / expand** | `styles["column-collapse-btn"]`, `column-expand-btn`, `is-collapsed`, `column-title-vertical` | Squashes a column to a vertical rail (desktop only). |
| **Column sort group** | `styles["column-sort-group"]`, `column-sort-btn` | Per-column sort buttons: **$** (value), **A/Z**, the stage's own date short label (**RFP / Appt / Prop / Won / Prod / Inv / Paid**), **☰** (hand-arranged `board_order`), and on the Sent column only **FU** (last follow-up). |
| **☰ / arranged order** | `compareBoardOrder` in `SalesBoardClient.tsx`; column `"Sales Board".board_order` | The order deals were dragged into in MasterDash's job board; unarranged deals sort after arranged ones. |
| **Column total** | `styles["column-total"]` | Sum of the column's deal values. |
| **Column body / empty** | `styles["column-body"]`, `column-empty` ("No deals") | The scrollable card list. |
| **Lead panel toggle** | `styles["lead-panel-toggle"]`; state `leadPanelView` | Only on the Lead column: **Leads** ⇄ **Loose ends**. |
| **Loose ends** (view) | `leadPanelView === "loose"`, `data-flag-drop` | Flagged deals from *every* stage. Dropping a card here flags it rather than moving its stage. |
| **Deal card** | `DealCard` — `src/app/sales-board/DealCard.tsx`; `styles.card` | The unit of the board. Sub-parts: `card-top`, `card-name`, `card-name-desc`, `card-value`, `card-flag` (🚩), `card-photo-badge` (📷, Propose only), `card-doc-badge` (📄, Sent only), `card-proposal-date` (Appt/Sent), `card-corr-icons`/`card-corr-day` (last call/text/email day, `is-stale` past 30 days), `card-schedule-date` ("Prod 03/03–03/07"), `card-next-action`, `card-error`. |
| **Drag ghost** | `styles["drag-ghost"]`, `is-dragging`, `is-dragover` | Cloned card that follows the pointer; the hovered column gets `is-dragover`. |
| **Hover property photo** (floating) | `styles["card-hover-photo"]`; `hoverPhotoMode === "floating"` | 260×190 preview beside the hovered card. Settings → Sales Board view. |
| **Property photo pane** (wide screen) | `PropertyPhotoPane` — `src/app/sales-board/PropertyPhotoPane.tsx`; `styles["photo-pane"]` | Full-height pane after the last column showing the last-hovered deal's key photo. |
| **Phone pager** | `styles["phone-pager"]`, `phone-pager-arrow`, `phone-pager-stage`, `phone-pager-count`, `phone-pager-dots`, `phone-pager-dot` | On phones the board becomes one stage per screen; this is the ‹ Stage N ›/dots pager. |
| **Swipe card** | `styles["swipe-card"]`, `swipe-lead`, `swipe-trail`, `swipe-action`, `is-swiped` | Phone-only email-style swipe. Leading (swipe right) = **Advance** to the next stage; trailing (swipe left) = **Album 🖼️**, **Flag 🚩**, **Lost ✕**. |

#### 3.3 Tiles view

| Term | Code identifier | What it is |
|---|---|---|
| **Tiles view** | `DealTiles` — `src/app/sales-board/DealTiles.tsx` | Photo-forward grid of every deal. Disambiguate: this "tile" ≠ Launch Pad tile ≠ plant tile. |
| **Tiles toolbar** | `styles["dt-toolbar"]`, `dt-search`, `dt-count`, `styles["tile-sort"]` | "Filter deals…", "N of M", sort **Stage / Value / A–Z**. |
| **Stage filter bar / chips** | `styles["dt-filterbar"]`, `dt-chip` | **All** + one chip per stage, colored by `--col-color`. Shared with the Table view. |
| **Deal tile** | `styles.tile`, `tile-photo`, `tile-photo-empty` (monogram), `tile-stage`, `tile-flag`, `tile-value`, `tile-body`, `tile-name`, `tile-contact`, `tile-address`, `tile-next` | Cover photo + stage pill + value + name/contact/address/next action. |
| **Tile grid / tile pager / tile page** | `styles["tile-grid"]`, `tile-pager`, `tile-page`, `tile-page-list` | Desktop = one flat grid; phone = one full-width column per stage with the same phone pager. |

#### 3.4 Table view

| Term | Code identifier | What it is |
|---|---|---|
| **Deal table** | `DealTable` — `src/app/sales-board/DealTable.tsx`; `styles["deal-table"]`, `table-wrap`, `table-scroll` | Sortable/filterable spreadsheet of every deal. |
| **Table columns** | `COLUMNS` in `DealTable.tsx` | Deal, Description, Stage, Value, Contact, Jobsite, RFP, Appt, Proposal, Won, Production, Invoiced, Paid, Next action. |
| **Column sort button** | `styles["dt-sort"]`, `dt-arrow` | asc → desc → off. |
| **Export CSV** | `styles["dt-export"]`, `exportCsv()` | Downloads `sales-board.csv` of the currently visible rows. |
| **Row** | `styles["dt-row"]`, `dt-name`, `dt-stage`, `dt-right`, `dt-empty` | Click / Enter opens the deal modal. |

#### 3.5 The **deal modal** — `DealModal`

`DealModal` — `src/app/sales-board/DealModal.tsx`. Full-screen overlay: `styles["modal-overlay"] + is-fullscreen`, panel `styles["modal-panel"] + is-fullscreen`. This is the screen the owner most often means by "the deal modal".

| Term | Code identifier | What it is |
|---|---|---|
| **Modal head** | `styles["modal-head"]`, `modal-head-left`, `modal-head-right`, `modal-title`, `modal-stage` | Deal name + stage (or "· Lost <date>"). |
| **Lock toggle** | `styles["modal-lock-btn"]`, `is-unlocked`; state `locked` | "🔒 Locked" ⇄ "🔓 Editing". Locked flips `readOnly` on every text field (`deal-form-fields.is-locked`); buttons and uploads still work. |
| **Album cover thumbnail** | `styles["deal-cover-photo"]`, `deal-cover-photo-hint` | Property cover photo at the top of the form; links to `/photos?deal=<id>`. |
| **Deal form body / fields** | `styles["deal-form-body"]`, `deal-form-fields` | The scrolling section stack. |
| **Section** | `styles["deal-section"]`, `deal-section-title`, `deal-section-title-row` | Each of the ten sections below. |

**Deal modal sections, in order:**

| Section | Code identifier | Contents |
|---|---|---|
| **Deal** | `<h3>Deal</h3>` in `DealModal.tsx` | Deal name (`dm-name`), Proposal description (`dm-description`), Company (`dm-company`), Value ($) (`dm-value`). |
| **Contact** | `<h3>Contact</h3>` | Contact first/last/email/phone (`dm-first`…`dm-phone`) plus row actions in `styles["aspire-link-row"]`: **👤 Add to Contacts** (vCard), **✉ Email** (mailto, logs an email touchpoint), **📞 Call** (tel, logs a call), and the **Text template menu**. |
| **Text template menu** | `TextTemplateMenu` — `src/app/sales-board/TextTemplateMenu.tsx` | "💬 Text ▾" dropdown of saved SMS templates (`/api/sms-templates`) with `{first_name}`/`{last_name}`/`{proposal_number}`/`{proposal_description}` token fill; add/edit templates inline. Sending logs a text touchpoint. |
| **Proposal & dates** | `<h3>Proposal & dates</h3>` | Proposal # (`dm-proposal-number`), **Find in Aspire** / **Open in Aspire ↗** / **↻ re-find** (`styles["aspire-parse-btn"]`), **👁 Watch live** (`aspire-live-row`, the Browserless live view), the **Aspire candidates** picker (`aspire-candidates`, `aspire-candidate`) when a proposal number matched several results, and the **Key dates grid**. |
| **Key dates grid** | `styles["date-stage-grid"]`, `date-stage-cell`, `date-stage-tag`, `date-input-row`, `date-clear-btn` (✕) | Eight dates each tagged with the stage they belong to: RFP date (Lead), Appointment date (Propose), Proposal date (Sent), Won date (Sold), Production start day + Production stop day (Project Management), Invoiced date, Paid in full date. |
| **Links & files** | `<h3>Links & files</h3>` | Aspire opportunity link (`dm-opportunity-link`), Proposal link (`dm-proposal-link`) + **Parse from Aspire** (`aspire-parse-btn`), **Proposal PDF** (`styles["proposal-pdf"]`, `proposal-pdf-link`, `proposal-pdf-add`, `proposal-pdf-remove`), and **Tools**. |
| **Tools** (a.k.a. the estimate + designs row) | `styles["tool-actions"]`, `tool-btn` | **📐 Open estimate · $X** or **📐 Create estimate** (`/api/sales-board/[id]/estimate`); one **🎨 \<design name\>** button per design plus **🎨 New design** (`/api/sales-board/[id]/design`). This is "the deal modal's Designs section". |
| **Attachments** | `<h3>Attachments</h3>`; `styles["attachments-list"]`, `attachment-row`, `attachment-link`, `attachment-icon`, `attachment-name`, `attachment-date`, `attachment-remove`, `attachment-actions`, `attachment-add`, `attachment-paste-btn` | POs / receipts (images + PDFs). "+ Add file", "📋 Paste from clipboard", plus a hidden `styles["paste-target"]`. |
| **Correspondence** | `<h3>Correspondence</h3>` | Log of calls / emails / texts and screenshots. **Composer** (`corr-composer`, `corr-composer-row`, `corr-composer-note`, `corr-composer-actions`) opened by "+ Log correspondence". **Entry** (`corr-entry`) shows channel icon + label + date; note body via `CorrespondenceText` (`corr-body`, `corr-body-text`, `corr-body-toggle` = Show more/less at 400 chars); attached **screenshots** (`corr-shots`, `corr-shot`, `corr-shot-remove`); per-entry actions (`corr-attach-actions`, `corr-attach-btn`): **📎 Attach image**, **📋 Paste**, **📝 Add/Edit note** (`corr-note-edit`). |
| **Emails** | `<h3>Emails</h3>`; `styles["deal-emails-list"]`, `deal-email`, `deal-email-head`, `deal-email-icon`, `deal-email-subject`, `deal-email-sub`, `deal-email-body`, `deal-emails-empty` | Read-only forwarded-in emails matched to the property's contact (`/api/emails/inbound`). Collapsible `<details>` rows. |
| **Transcripts** | `TranscriptsSection` / `TranscriptEditor` in `DealModal.tsx`; `styles["deal-transcripts-list"]`, `deal-transcript`, `deal-transcript-head`, `deal-transcript-meta`, `deal-transcript-title`, `deal-transcript-sub`, `deal-transcript-appt`, `deal-transcript-body`, `deal-transcript-actions`, `deal-transcript-add-btn`, `deal-transcript-form` | Appointment transcripts. New ones auto-link to the deal's Appointment event via `pickAppointmentEvent()`. Populated by the `plaud-transcript-import` skill. |
| **Property** | `<h3>Property</h3>` | Jobsite address via `PropertyPicker` (`dm-jobsite`), **📍 Map** and **🧭 Directions** links, **Geocode status** (`GeocodeStatus`, `styles["geocode-status"]`, `is-warn`, `is-muted`, `geocode-link`), **Other deals at this property** (`RelatedDeals`, `styles["related-deals"]`, `related-deal`, `related-deal-name`, `related-deal-stage`), and **Next action**. |
| **Next action** (block) | `styles["next-action-display"]`, `next-action-display-empty`, `next-action-links` | Shows the deal's next-action task text, "Manage tasks →", and `AddTaskInline`. |
| **Add task inline** | `AddTaskInline` in `DealModal.tsx`; `styles["inline-task-form"]`, `inline-task-form-row`, `inline-task-next-action`, `inline-task-hint`, `inline-task-error`, `inline-task-form-actions` | "+ Add task": title, context, date, hours, "Mark as this deal's next action". No deal picker — the deal is implied. |
| **Photos** | `<h3>Photos</h3>` + `styles["deal-album-link"]` ("🖼️ View full album →") | Photos grouped into **photo event groups**. |
| **Photo event group** | `styles["photo-events"]`, `photo-event-group`, `photo-event-header`, `event-type-badge`, `photo-event-name`, `photo-event-date`, `photo-event-link` | One block per calendar event; special blocks for **SITE PLAN** ("from the estimator") and **Reference** ("Property reference photos"). |
| **Photo row / thumb** | `styles["photo-row"]`, `photo-thumb`, `photo-thumb-placeholder`, `video-badge` (▶), `outlier-badge` (⚠), `photo-remove` (×) | The thumbnails themselves. |
| **Photo add row** | `styles["photo-add-row"]`, `photo-add` ("+ Photo"), `photo-add-hint` | Upload, plus the ⌘V-to-paste-a-reference-photo hint. |

**Deal modal footer** (`styles["deal-form-footer"]`):

| Term | Code identifier | What it is |
|---|---|---|
| **Photo strip** | `styles["deal-photo-strip"]`, `deal-photo-strip-item`, `is-correspondence`, `is-active`, `deal-photo-strip-icon`; ref `photoStripRef` | One continuous horizontal row of *every* photo AND correspondence/email/transcript marker across the whole **property** (all its deals), oldest-first. |
| **Deal timeline** | `styles["deal-timeline"]`, `deal-timeline-line`, `deal-timeline-slot`, `deal-timeline-icon` (`is-fulfilled`/`is-pending`), `deal-timeline-label`, `deal-timeline-date` | Six milestone slots (see `MILESTONES`, §7). Hovering a milestone scrolls the photo strip to that date. |
| **Timeline event dot** | `styles["deal-timeline-event"]`, `deal-timeline-event-dot`, `deal-timeline-event-tip`, `deal-timeline-eventMore` ("+N") | Events/correspondence plotted between milestones; hovering scrolls the strip, clicking an event dot jumps to `/calendar?event=`. |
| **Modal actions** | `styles["modal-actions"]`, `modal-actions-left`, `modal-actions-right` | Left: **⚑ Flag / 🚩 Unflag** (`modal-flag`, `is-flagged`), **Delete deal** (`modal-delete`), **Mark as Lost / Restore to pipeline** (`modal-lost`, `is-restore`). Right: **Cancel** (`card-edit-cancel`), **Save** (`card-edit-save`). |

#### 3.6 Other Sales Board modals/pickers

| Term | Code identifier | What it is |
|---|---|---|
| **Lost deals modal** | `LostModal` — `src/app/sales-board/LostModal.tsx`; `styles["lost-list"]`, `lost-item`, `lost-item-main`, `lost-item-name`, `lost-item-meta`, `lost-item-restore`, `lost-empty` | Opened from the **Lost** stat tile. Restore puts a deal back in the pipeline. |
| **Property picker** (a.k.a. jobsite address field) | `PropertyPicker` — `src/app/sales-board/PropertyPicker.tsx`; `styles["property-picker-new"]` | Search-and-match over existing properties, or deliberately add a new address. Addresses are never freely typed. |

#### 3.7 Sales Board gestures

| Gesture | Where | What it does |
|---|---|---|
| **Tap** a card | `handlePointerUp` in `DealCard.tsx` (`DOUBLE_TAP_MS = 300`) | Opens the deal modal. |
| **Double-tap** a card | same | Jumps to that deal's photo albums (`/photos?deal=`). |
| **Hold-to-drag** (finger) | `DRAG_HOLD_MS = 450` in `DealCard.tsx` | 450 ms hold anywhere on the card grabs it; quick swipes still scroll the column. |
| **Grab-and-drag** (pen/mouse) | `DRAG_THRESHOLD = 6` | Apple Pencil / mouse grabs immediately on movement, no wait. |
| **Long-press** (pen/mouse) | `LONG_PRESS_MS = 550`, `styles["is-link-armed"]` | Hold still to arm, release opens the deal's Aspire **opportunity link**. |
| **Swipe left / right** on a phone card | `SWIPE_DECIDE_PX/ACTION_W/LEAD_W` in `DealCard.tsx` | Reveals trailing actions (Album/Flag/Lost) or the leading Advance action. |
| **Swipe across** the phone board | `handleBoardScroll` / `scrollToPage` | Pages one stage at a time. |
| **Long-press a deal tile** | `LONG_PRESS_MS = 500` in `DealTiles.tsx` | Opens the property photo album. |
| **⌘V anywhere in the deal modal** | shared paste listener in `DealModal.tsx` | An untargeted image paste becomes a **property reference photo**. Arming Attachments' or Correspondence's own Paste button claims that ⌘V instead. |
| **Drag Sent → Sold** | `openWonEmail` in `SalesBoardClient.tsx` | Stamps the won date and opens the internal "SOLD:" mail notice to raquel@ / cc dean@. |

---

### 4. Calendar — `/calendar`

**Screen:** `src/app/calendar/page.tsx` → `CalendarClient` — `src/app/calendar/CalendarClient.tsx`. Styles: `src/app/calendar/calendar.module.css`. NavBar label: **Calendar**. Purpose: week grid of jobsite events (auto-grouped from photo GPS+time or made by hand), plus planning blocks and production windows.

| Term | Code identifier | What it is |
|---|---|---|
| **Topbar** | `styles.topbar`, `styles.brand` | "Calendar — Job site events, auto-grouped from photo timestamps & location or created by hand". |
| **Toolbar** | `styles.toolbar`, `styles["nav-btn"]` | ‹ Prev, Today, Next ›, **Work Week**, **2 Weeks**, **📅 Outlook**, range label, `PhotoUpload`, **+ New Event**, **+ New Block**, `ImportOutlookEvent`, and the ungeotagged note. |
| **Work Week** | state `workWeek`; `START_HOUR = 6`, `END_HOUR = 17` | Hides Sat/Sun *and* condenses the axis to 6am–5pm so it fills the screen. |
| **2 Weeks** | state `twoWeek`, `span` | 7-day ⇄ 14-day span; Prev/Next/swipe page by the span. |
| **Range label** | `styles["range-label"]` | e.g. "Mar 3 – Mar 9". |
| **Ungeotagged note** | `styles["ungeotagged-note"]` | "N photos without location data can't be placed here." |
| **Week wrap / week header / day header** | `styles["week-wrap"]`, `week-header`, `day-header` (`is-today`), `day-name`, `day-num` | The grid frame and its day columns. |
| **All-day row (Production track)** | `styles["allday-row"]`, `allday-gutter` (labelled "Production"), `allday-track` | Multi-day bars for deals with a production window. |
| **Production bar** | `styles["allday-bar"]`, `allday-bar-label`, `allday-bar-dragging`, `clip-start`, `clip-end`, `allday-resize-start`, `allday-resize-end`; `layoutProductionBars()` | Draggable/resizable all-day bar = a deal's `start_date`…`end_date`. |
| **Week body / time gutter / hour label** | `styles["week-body"]`, `time-gutter`, `hour-label`; `HOUR_HEIGHT = 48` | The hour rail. |
| **Day column** | `styles["day-column"]` | One per visible day; the drop target for block drags. |
| **Planning block** (band) | `styles["planning-block"]`, `planning-block-label`, `planning-block-deals`, `planning-block-deal`, `planning-block-dragging` | A faded, stage-tinted intent window. Lists up to 5 deals the scheduler placed in it, then "+N more". |
| **Event block** | `styles["event-block"]`, `no-location`, `no-deal`, `is-dragging`, `event-title`, `event-meta`, `event-type-badge`, `event-photo-badge`, `event-resize-handle` | A calendar event. Drag to move; the top/bottom handles resize (15-minute snap, `SNAP_MS`). |
| **Outlook overlay event** | `styles["outlook-event"]`, `outlook-event-title`, `outlook-allday`, `outlook-import-btn` | Read-only events from the published .ics feed; the import button runs the appointment parser. |
| **Empty week** | `styles["empty-week"]` | "No located photo events this week." |

#### 4.1 Calendar modals

| Term | Code identifier | What it is |
|---|---|---|
| **Event details modal** | `styles["modal-overlay"]`/`modal-panel"]` + `modal-head`, `modal-title`, `modal-subtitle`, `modal-head-actions`, `modal-close`, `delete-btn` | Opened by clicking an event (also reachable via `?event=<id>` deep links from the deal modal). |
| **Event edit form** | `styles["event-edit-form"]`, `event-edit-label`, `upload-error`, `upload-actions` | Name, type, start/end, property, deal, notes. Attaching a deal to an **Appointment** copies the day into `deal.appointment_date` (`syncDealAppointmentDate`). |
| **Merge bar** | `styles["merge-bar"]` | Merge this event into another. |
| **Bulk match bar** | `styles["bulk-match-bar"]`, `bulk-match-actions`, `bulk-match-btn`, `upload-select` | "+ Create New Deal", "Connect existing deal", suggested deals sharing the property's contact last name. |
| **Deal chip list** | `styles["deal-list"]`, `deal-chip`, `deal-chip-name`, `deal-chip-meta`, `deal-chip-link` | Deals attached to this event, each linking to its album. |
| **Event notes** | `styles["event-notes"]` | Free text on the event. |
| **Photo grid** | `styles["photo-grid"]`, `photo-thumb`, `photo-thumb-placeholder`, `video-badge`, `outlier-badge` | The event's photos/videos. |
| **Lightbox** | `styles["lightbox-overlay"]`, `lightbox-panel`, `lightbox-image-wrap`, `lightbox-video`, `lightbox-foot`, `lightbox-nav` | Full-size viewer with ‹ ›, **Mark up** (opens `PhotoAnnotator`), **Revert**, Close. |
| **New event modal** | `<h2>New event</h2>` in `CalendarClient.tsx` | Same field set as the edit form. |
| **Block editor modal** | `BlockEditorModal` — `src/app/calendar/BlockEditorModal.tsx` | "the calendar's block editor". Stage, Title, Kind (**one-off** / **recurring**), date or weekday chips (`WEEKDAYS`), Starts on / Ends on, Start/End time, Save + Delete. |
| **Photo upload (from calendar)** | `PhotoUpload` — `src/app/calendar/PhotoUpload.tsx` | "Add photos & videos" modal: reads GPS client-side, matches to a deal/property, lets you set an **Event type for new events**, includes a "No Location" option and inline "New property address". Also handles page-wide ⌘V paste. |
| **Event photo / media upload** | `EventPhotoUpload.tsx`, `EventMediaUpload.tsx` | Attach photos/videos to an event directly, no deal required. |
| **Import Outlook event** | `ImportOutlookEvent` — `src/app/calendar/ImportOutlookEvent.tsx` | Paste an Outlook appointment's text; the parser extracts contact/phone/email/address into a matched-or-new property plus an event. |

#### 4.2 Calendar gestures

| Gesture | Where | What it does |
|---|---|---|
| **Horizontal swipe** on the week | `SWIPE_MIN_DISTANCE = 60`, `SWIPE_DIRECTIONAL_RATIO = 1.5` | Previous / next week (or fortnight). |
| **Drag an event** | `beginDrag` | Moves it; 15-minute snap, 20-minute minimum. |
| **Drag an event's handle** | `styles["event-resize-handle"]` | Resize start or end. |
| **Drag a planning block** | `beginBlockDrag`; `detachBlock` | Moves it in minutes-of-day and across day columns. Dragging **one occurrence of a recurring block** detaches it into a standalone one-off; the series is unchanged. |
| **Drag a production bar** | `beginProdDrag` | Move / resize a deal's production window by whole days. |

---

### 5. Photo Gallery — `/photos`

**Screen:** `src/app/photos/page.tsx` → `PhotoGalleryClient` — `src/app/photos/PhotoGalleryClient.tsx`. Styles: `src/app/photos/photos.module.css`. NavBar label: **Photos**. Page title: **Photo Gallery**.

| Term | Code identifier | What it is |
|---|---|---|
| **Album** (preferred) / "property photo group" | `styles.album` in `photos.module.css`; keyed by `property.key` | One tile per **property** (not per deal). Deep links: `?property=<id>` or `?deal=<id>`. |
| **Album grid** | `styles.grid`, `grid-large` | The album tiles; `grid-large` = the big-tile toggle. |
| **Album tile parts** | `styles["thumb-image-wrap"]`, `thumb-placeholder`, `album-badge`, `thumb-caption`, `thumb-caption-name`, `thumb-caption-stage` | Cover image, photo count, property label, stage. |
| **Topbar actions** | `styles["topbar-actions"]`, `caption-toggle`, `back-link` | Collapse/expand all sections, sort by **appointment**, tile size, **captions overlay** toggle, "‹ back to albums". |
| **Stage filter bar** | `styles["stage-filter-bar"]`, `stage-filter-chip`, `stage-filter-actions`, `stage-filter-link` | Filter albums by pipeline stage; All / None links. |
| **Deal group** | `styles["deal-group"]`, `deal-group-header`, `deal-group-name`, `data-deal-group` | Inside an album, photos are grouped per deal. |
| **Event group** | `styles["event-group"]`, `event-group-header`, `event-group-name`, `event-group-name-btn`, `event-group-date`, `event-group-link`, `event-type-badge`, `event-collapse-btn`, `drag-over` | One section per calendar event; also the special sections **REFERENCE / "General reference"**, **SITE PLAN / "Site Plan"** ("from the estimator"), and **ACTION / "Actions"** ("tap ⚡ to set the next action"). |
| **Event add actions** | `styles["event-add-actions"]`, `event-add-btn`, `event-paste-btn`, `event-upload-status`, `event-paste-error` | Per-section upload / paste. |
| **Thumb** | `styles.thumb`, `thumb-open`, `thumb-caption-overlay`, `video-badge` (▶), `walkthrough-badge` (**WALK-THRU**), `outlier-badge` (⚠) | A photo tile. |
| **Cover star** | `styles["thumb-cover"]`, `is-cover`; `lightbox-cover` | Set / unset the property's `cover_photo_id`. |
| **Next-action bolt (⚡)** | `styles["thumb-next-action"]`, `is-next-action` | Marks a photo as the deal's `next_action_photo_id`. |
| **Action dropzone** | `styles["action-dropzone"]`, `reference-empty` | "drag a photo here to add it as an action" / "drag a photo here to add one" (reference). |
| **Lightbox** | `styles["lightbox-overlay"]`, `lightbox-panel`, `lightbox-back`, `lightbox-image-wrap`, `lightbox-head`, `lightbox-title`, `lightbox-caption-input`, `lightbox-actions`, `lightbox-nav`, `lightbox-annotate`, `lightbox-delete`, `lightbox-close`, `lightbox-video`, `lightbox-dims`, `lightbox-dims-chip` | Full-size viewer: caption editing, ‹ ›, cover star, ⚡, **Mark up**, **Link to take-off**, links into the estimator (`/estimator/<id>` and `?plan=1`), delete. |
| **Take-off linker** | `EstimateGroupLinker` — `src/app/photos/EstimateGroupLinker.tsx` | "Link to take-off" modal: attach a photo to one or more of its deal's estimate take-off groups. |

---

### 6. Properties — `/properties`

**Screen:** `src/app/properties/page.tsx` → `PropertiesClient` — `src/app/properties/PropertiesClient.tsx`. Styles: `src/app/properties/properties.module.css`.

| Term | Code identifier | What it is |
|---|---|---|
| **View toggle** | `styles["view-toggle"]`, `view-toggle-btn` | **Table** ⇄ **Map**. |
| **Upright import** | `nav-btn` → `/api/upright/import`; `styles["import-toast"]`, `import-toast-close` | "Import pending Upright site sessions into property albums and the calendar." |
| **Appointment filter chip** | `styles["stage-filter-chip"]` with `apptOnly` | Only properties with an appointment today or later. |
| **Stage filter bar** | `styles["stage-filter-bar"]`, `stage-filter-chip`, `stage-filter-divider`, `stage-filter-actions` | Same chip pattern as Photos. |
| **Properties table** | `styles.table`, `table-wrap`, `is-highlighted` | Columns: contact last name, address, contact details, deals, events, geocode status. |
| **Table cells** | `styles["contact-name"]`, `address-cell`, `address-text`, `edit-prop-btn`, `contact-detail`, `no-contact`, `deals-cell`, `count-pill`, `new-deal-btn`, `geocode-yes`, `geocode-no`, `geocode-set-link` | — |
| **Property map** | `PropertyMap` — `src/app/properties/PropertyMap.tsx`; `styles["map-view"]`, `map-wrap`, `map-pin`, `map-pin-label`, `map-popup-title`, `map-popup-detail` | Leaflet map; pin color = the property's *least-advanced* deal stage. |
| **Map search** | `styles["map-search"]`, `map-search-input`, `map-search-count` | "Search name or address…"; flies/fits to matches. |
| **Add property modal** | `<h2>Add property</h2>`; `styles["modal-panel"]`, `form`, `field`, `field-row`, `form-error`, `form-actions`, `btn-cancel`, `btn-submit` | Address + contact fields. |
| **Edit property modal** | `<h2>Edit property</h2>` | Same fields for an existing property. |
| **Set location modal** | `SetLocationModal` — `src/app/properties/SetLocationModal.tsx`; `styles["location-modal-panel"]`, `location-modal-address"]`, `location-search-bar`, `location-search-note`, `location-modal-hint`, `location-modal-map` | Drop a pin by hand when geocoding failed. |

---

### 7. Next Actions — `/next-actions`

**Screen:** `src/app/next-actions/page.tsx` → `NextActionsClient` — `src/app/next-actions/NextActionsClient.tsx`. Styles: `src/app/next-actions/next-actions.module.css`.

| Term | Code identifier | What it is |
|---|---|---|
| **Header hint** | `styles.hint` | "Click into a row and type — Enter or ↓/↑ saves and moves to the next deal." |
| **Filter bar** | `styles["filter-bar"]`, `search-input` (⌥K), `filter-toggle` | Search + toggles. |
| **Stage dropdown** | `styles["stage-dropdown"]`, `stage-dropdown-btn`, `stage-menu`, `stage-menu-backdrop`, `stage-menu-actions`, `stage-menu-item`, `stage-menu-dot` | Multi-select stage filter. |
| **Action list chips** | `styles["action-list-filters"]`, `action-list-chip`, `chip-count`; `verbOf()` + synonym groups | Chips built from the *leading verb* of each next action (e.g. "Purchasing" merges order/purchase/buy). |
| **List toolbar** | `styles["list-toolbar"]`, `order-toggle`, `order-btn`, `collapse-all-btn` | Order by **Stage** or **A–Z**; collapse all stage groups. |
| **Timeline column** | `styles["timeline-header-cell"]`, `timeline-cell`; `DealTimeline` — `src/app/next-actions/DealTimeline.tsx` | First table column. |
| **Milestone timeline** | `MILESTONES` in `DealTimeline.tsx`; `styles.timeline`, `timeline-line`, `timeline-msSlot`, `timeline-node`, `timeline-icon` (`is-fulfilled`/`is-pending`), `timeline-date` | Six fixed slots: **Appointment 🏠**, **Proposal Sent 📤**, **Sold 🤝**, **Production 🚧**, **Invoiced 🧾**, **Paid in Full 💰**. Same widget as the deal modal's footer timeline. |
| **Timeline sort header** | `TimelineSortHeader`; `styles["timeline-sort-btn"]`, `timeline-sort-icon`, `timeline-sort-caret` | Per-milestone sort buttons sitting directly above each icon. |
| **Table columns** | `<thead>` in `NextActionsClient.tsx` | (timeline), **Deal**, **Next Action**, **Photos**, **Contact**. |
| **Stage header row** | `styles["stage-header-row"]`, `stage-collapse-btn`, `collapse-caret`, `stage-count` | Group divider per stage. |
| **Action input** | `styles["action-input"]`, `action-cell` | Inline editable next action ("No next action — type to add one"). |
| **Photo strip (row)** | `styles["photo-strip"]`, `photo-item`, `photo-thumb`, `photo-marked`, `photo-marked-badge` (⚡), `photo-remove`, `photo-add`, `photo-file-input`, `photo-paste`, `photo-paste-target` | The row's next-action photo plus add/paste. |
| **Contact actions** | `styles["contact-cell"]`, `contact-actions`, `contact-btn` | 📞 Call / ✉️ Email / 💬 Text (compact `TextTemplateMenu`); each logs a correspondence touchpoint. |

---

### 8. Action Photos — `/next-action-photos`

**Screen:** `src/app/next-action-photos/page.tsx` → `NextActionPhotosClient`. NavBar label: **Action Photos**; page title **Next Action Photos**.

| Term | Code identifier | What it is |
|---|---|---|
| **Card** | the `cards.map` in `NextActionPhotosClient.tsx` | One deal's next action, photo-forward. `url === null` = no photo yet. |
| **"No photo yet" toggle** | button titled "Show next actions that have no photo yet" | Include photoless next actions. |
| **Overlay toggle** | button titled "Overlay the next action on each photo" | Draws the action text over the photo. |
| **Tile size toggle** | `bigTiles` state | Smaller / larger tiles. |

---

### 9. Tasks — `/tasks`

**Screen:** `src/app/tasks/page.tsx` → `TasksClient` — `src/app/tasks/TasksClient.tsx`. Styles: `src/app/tasks/tasks.module.css`.

| Term | Code identifier | What it is |
|---|---|---|
| **Filter bar** | `styles["filter-bar"]`, `filter-chip`, `filter-select`, `filter-toggle`, `filter-actions`, `filter-link` | Context chips (`TASK_CONTEXTS`), deal select, show-completed toggle, All/None. |
| **Tasks table** | `styles.table`, `table-wrap` | Done checkbox, Title, Deal, Context, Start date, Duration, Photos, Next-action badge. |
| **Row parts** | `styles["done-checkbox"]`, `task-title`, `task-deal`, `no-deal`, `context-chip`, `no-value`, `task-duration`, `task-photo-strip`, `task-photo-thumb`, `task-photo-more`, `next-action-badge` (★ Next action), `is-completed` | — |
| **Add / Edit task modal** | `<h2>{editingTask ? "Edit task" : "Add task"}</h2>`; `styles["modal-panel"]`, `form`, `field`, `field-row`, `next-action-field` (`is-disabled`), `form-hint`, `form-error`, `form-actions`, `form-actions-right`, `btn-danger`, `btn-cancel`, `btn-submit` | ⌥N opens it. |
| **Task photo lightbox** | `styles.lightbox`, `lightbox-content`, `lightbox-close` | Views a task photo. |

---

### 10. Planner — `/planner`

**Screen:** `src/app/planner/page.tsx` → `PlannerClient` — `src/app/planner/PlannerClient.tsx`. Styles: `src/app/planner/planner.module.css`. Purpose: a Gantt-style board of deals across a rolling horizon, driven by the shared scheduler.

| Term | Code identifier | What it is |
|---|---|---|
| **Controls** | `styles.controls`, `horizon`, `resetAll` | Horizon length, "Reset all". |
| **Fortnight nav** | `styles.fortnightNav`, `fortnightLabel`, `shiftBtn` | Page the 2-week window; "Back to the current 2 weeks". |
| **Filter bar** | `styles.filterBar`, `filterChip`, `filterOn`, `blocksChip` | Stage chips + "blocks only" (the schedulable view). |
| **Legend** | `styles.legend`, `legendItem`, `legendDot`, `shiftBtn` | Per-stage color key with ‹ › to shift a whole stage earlier/later. |
| **Board / scroll / inner** | `styles.board`, `scroll`, `inner` | The scrolling Gantt surface. |
| **Gantt row** | `styles.ganttRow` | One deal per row — "drag anywhere on this row to reschedule". |
| **Stage band** | `styles.stageBand`; `stageSpans()` | Colored history segments showing which stage the deal was in over time. |
| **Day grid / grid / today line / axis** | `styles.dayGrid`, `grid`, `today`, `axis`, `monthLabel`, `dayNum`, `dayNumToday` | Background rules and the date axis. |
| **PM tile** | `styles.pmTile`, `pmTileName` | A Project-Management deal drawn as its production window tile. |
| **Chip / item** | `styles.item`, `itemName`, `itemMeta`, `itemDragging`, `chipAuto`, `chipPinned`, `chipIssue`, `nameAuto`, `nameIssue`, `itemIssueTag`, `resetBtn` | A scheduled deal. **auto** = the scheduler placed it, **pinned** = a manual `planning_placements` row, **issue** = `unplaced` / `oversized` / `needsEstimate` (`BoardIssue` in `src/lib/planning/board.ts`). |
| **Drop guide / drop target** | `styles.dropGuide`, `dropTarget` | Snap guides while dragging. |

---

### 11. Master Catalog — `/master-catalog`

**Screen:** `src/app/master-catalog/page.tsx` → `MasterCatalogPageClient` — which toggles between two views.

| Term | Code identifier | What it is |
|---|---|---|
| **Editor view** | `MasterCatalogClient` — `src/app/master-catalog/MasterCatalogClient.tsx` | The write surface: materials → their applications, equipment, assemblies. Reads/writes `/api/estimator/master`. |
| **Gallery view** | `MasterGalleryClient` — `src/app/master-catalog/MasterGalleryClient.tsx` | Photo-forward, drill-down browse of the same model. |
| **Editor⇄gallery toggle** | injected by `MasterCatalogPageClient.tsx` | Same pattern as the legacy catalog page. |
| **Materials layout toggle** | `materialsLayout` state ("grouped" / "table") | Grouped expandable editor vs a flat materials-only table. |
| **Lock toggle** | title "Unlock to edit" / "Lock to prevent edits" | Read-only guard on both views. |
| **Aspire CSV import** | button titled "Import / update the Aspire catalog from a CSV export" | Loads the `aspire_catalog` reference table. |
| **Aspire suggest modal** | `AspireSuggestModal` — `src/app/master-catalog/AspireSuggestModal.tsx` | "Suggested Aspire matches" — bulk confirm-map materials to Aspire items, scored `STRONG`/`GOOD`. |
| **Aspire name picker** | `AspireNamePicker` — `src/app/master-catalog/AspireNamePicker.tsx` | "Search Aspire catalog…" typeahead mapping one material to one exact Aspire item. |
| **Gallery tabs** | `TABS` in `MasterGalleryClient.tsx` | **Phases 🏗️**, **Materials 📦**, **Assemblies 🧱**, **Equipment 🚜** (`EntityType` = `stage | material | assembly | equipment`). |
| **Breadcrumb / drill** | `gotoDepth`, `stack`, "All \<plural\>" | Clicking a tile makes it the header and filters the grid to its related entities. |

---

### 12. Estimator (legacy) — `/estimator`, `/estimator/[id]`

**List:** `EstimateListClient` — `src/app/estimator/EstimateListClient.tsx` (title **Estimates**).
**Editor:** `src/app/estimator/[id]/client.tsx` → `EstimatorApp` — `src/components/estimator/EstimatorApp.jsx` (title **Landscape Estimator**). Ported Vite/JSX app; see `docs/estimator-integration-plan.md`.

| Term | Code identifier | What it is |
|---|---|---|
| **Estimator top bar** | `<header>` in `EstimatorApp.jsx` (green-800) | Back to **Estimates**, save-state text, then **New**, **Plan**, **Quick Add**, **Save**, **Load**, **Import**, **Print**. |
| **Catalog panel** | `CatalogPanel` — `src/components/estimator/CatalogPanel.jsx` | Left rail. "Drag items onto the estimate"; also holds the **Take Off Group** creator tile ("Drag to create a group") and saved **kits**. |
| **Catalog card** | `CatalogCard.jsx` | One draggable catalog item. |
| **Estimate panel** | `EstimatePanel.jsx` | Center. Column head **Qty / Item / … / Total**; empty state "Drag items here from the catalog". |
| **Estimate header** | `EstimateHeader.jsx` | Client name ("John Smith") + project name ("Backyard Renovation"). |
| **Take-off group row** | `TakeOffGroupRow.jsx` | A group band: color swatch, takeoff-type cycler, **Face Ft** readout, "Take Off Label", operation **stage** select, save-as-kit, link-photos, notes toggle, remove. |
| **Estimate row** | `EstimateRow.jsx` | A single line item. |
| **Estimate summary** | `EstimateSummary.jsx` | Right/bottom totals: **By phase** breakdown, Subtotal, Tax, **Total**. |
| **Quick picker** | `QuickPicker.jsx` | "/" or ⌘K. "Search catalog…" with "Adding to \<group\>" / "top level". |
| **Import modal** | `ImportModal.jsx` | "Import from Transcript" — paste JSON of groups/items. |
| **Assembly kit modal** | `AssemblyKitModal.jsx` | "Save as Assembly Kit": name, description, **Default Takeoff Type**, **Plan Annotation Color**. |
| **Photo links modal** | `PhotoLinksModal.jsx` | "Linked photos": Linked (N) / Attach a photo; "Place a pin on the plan". |
| **Plan view** | `PlanView.jsx` | Full-screen takeoff canvas. |
| **Plan toolbar** | toolbar in `PlanView.jsx` | **← Back**, **Calibrate**, **Area**, **Linear**, **Plant**, **Item**, **Select**, plus the measurements toggle (`123` / `···`) and a per-tool hint (`toolHints`). |
| **Area kit sub-toolbar** | `activeTool === 'area'` block | "Kit:" chips (None + each area kit). |
| **Plan canvas** | `PlanCanvas.jsx` | The drawing surface; zoom out / reset to fit / zoom in. |
| **Plan shape list** | `PlanShapeList.jsx` | Shapes drawn on the plan. |
| **Loads / crew / labor-day panel** | in `PlanView.jsx` — "Loads", "Trucks / day", "Crew / day", "Labor days", "Material" | Delivery-load truck icons, crew size, production-day rows, per-material load breakdown. |
| **Print view** | `PrintView.jsx` | Printable proposal layout. |
| **Site plan image** | `photo_type = "Site_Plan_Image"` (`SITE_PLAN_IMAGE_TYPE`) | The plan image saved back onto the deal's photo album. |

---

### 13. Design (PerspectivePhoto) — `/design`, `/design/[id]`

**List:** `DesignListClient` — `src/app/design/DesignListClient.tsx` (title **Designs**).
**Editor:** `src/app/design/[id]/client.tsx` → `DesignApp` — `src/components/design/DesignApp.tsx` (Konva, client-only). Plan doc: `docs/perspectivephoto-integration-plan.md`.

| Term | Code identifier | What it is |
|---|---|---|
| **Design toolbar** | `Toolbar` — `src/components/design/components/Toolbar/Toolbar.tsx` | The 56px top bar. |
| **Tools sidebar** | `ToolsSidebar` — `src/components/design/components/GestureControls/ToolsSidebar.tsx` | Left rail: size slider, category toggle, movement joystick, stamp-gun/duplicate toggle, delete, undo/redo. |
| **Object strip** | `ObjectStrip` — `src/components/design/components/StampLibrary/ObjectStrip.tsx` | Right-hand plant/object library strip: Upload, Paste, next-category, add/delete subcategory. |
| **Canvas** | `EditorCanvas` (photo), `PlanViewCanvas` (plan), `LightingCanvas` (lighting) — `src/components/design/components/…` | The three interchangeable canvases. |
| **View modes** | `viewMode` in `src/components/design/store/useProjectStore.ts`; Toolbar's Photo/Plan/Lighting segmented control | **Photo** (1), **Plan** (2), **Lighting** (3). |
| **Tool modes** | `ToolMode` in `src/components/design/types/index.ts`; `tools[]` in `Toolbar.tsx` | `select` **Select**, `calibrate` **Calibrate** (photo), `eraser` **Erase Overlay** (photo), `objEraser` **Object Eraser** (plan), `placeLight` **Place Light**, `lightPen` **Light Pen**, plus `horizon` and `pan`. |
| **Toolbar buttons** | `ToolButton` in `Toolbar.tsx` | **Upload Photo**, **Use Jobsite Photo** (deal-linked only), **Upload Plan Image**, tool modes, **Cluster Outlines** (plan), view toggle, **Undo**/**Redo**, **Delete**, **Import Library**/**Export Library**, **Plant Database**, **Paste Overlay** (flatten), **Export PNG**, Help, Settings. |
| **Plan diameter display** | `PlanDiameterDisplay` in `Toolbar.tsx` | Center readout of the selected plan symbol's real-world diameter. |
| **Stamp** | `CustomStamp` / `StampAsset` in `src/components/design/types/index.ts`; `PlantStamp`, `PlanStamp`, `PlanStampCircle` | A placed plant/object. Perspective stamps auto-scale by depth. |
| **Stamp library / stamp card / texture grid** | `StampLibrary.tsx`, `StampCard.tsx`, `TextureGrid.tsx` ("My Textures") | The library panels. `PLANT_CATEGORIES`: Shade Trees, Ornamental Trees, Grasses, Shrubs, Perennials, Ground Cover. |
| **Category toggle** | `CategoryToggle.tsx`; `categories` in `ToolsSidebar.tsx` | Deciduous, Evergreens, Grasses, Shrubs, Perennials, Other. |
| **Size slider** | `SizeSlider.tsx`; `TRACK_HEIGHT = 180` in `ToolsSidebar.tsx` | Vertical scale slider (10%–500%). |
| **Movement joystick** | `MovementJoystick.tsx` | Nudge the selected stamp without grabbing its handles. |
| **Properties panel** ("selected-item bar") | `PropertiesPanel` — `src/components/design/components/PropertiesPanel/PropertiesPanel.tsx` | Size, Opacity, Rotate, Flip, Bring Forward / Send Back, Duplicate, Delete. |
| **Calibration overlay** | `CalibrationOverlay.tsx`; `CalibrationRef` (default 5.75 ft) | The person silhouette used to fix perspective scale. |
| **Perspective guides / horizon** | `PerspectiveGuides.tsx`; `PerspectiveConfig` (`horizonY`, `groundY`, `vanishingPointX`, `baseScale`) | The horizon line that drives depth scaling. |
| **Plan overlay** | `PlanOverlay.tsx` | The plan crop warped onto the photo by a 4-corner drag (homography, `engine/homography.ts`). "Paste Overlay" flattens it down. |
| **Cluster overlay** | `ClusterOverlay.tsx`, `clusterUtils.ts` | Grouped outlines around massed plantings. |
| **Lighting** | `LightingOverlay.tsx`, `LightMarker.tsx`, `LightPropertiesPanel.tsx`, `lightPresets.ts` | Darkens the scene; presets **Uplight**, **Path Light**, **Spotlight** (`LIGHT_PRESET_LABELS`). |
| **Plant table** | `PlantTable` — `src/components/design/components/PlantTable.tsx` | Library table: Name, Botanical Name, Common Name, Category, Notes. |
| **Jobsite photo picker** | `JobsitePhotoPicker.tsx` | "Use a jobsite photo" — pick a background from the design's deal/property photos. |
| **Settings menu** | `SettingsMenu.tsx` | Photo Saturation, Brightness, Contrast, Photo Opacity, Perspective, App. |
| **Help panel** | `HelpPanel.tsx` | "Help & shortcuts" cheat sheet — `SECTIONS` and `SHORTCUTS` here are the authoritative in-app description of the design tool's gestures. |
| **Reference plant picker** | `ReferencePlantPicker` — `src/app/plants/ReferencePlantPicker.tsx` | "Link to a reference plant" — ties a design stamp to a `public.plants` row. |

---

### 14. Plants — `/plants`  and  Plant Reference — `/plant-reference`

Two distinct catalogs; keep them apart.

| Term | Code identifier | What it is |
|---|---|---|
| **Plants** / "Plant Database" | `PlantDatabaseClient` — `src/app/plants/PlantDatabaseClient.tsx`; NavBar **Plants** | The **design stamp library** (`pp_library_items`) as a gallery/table: name, botanical, common, notes, linked reference plant. |
| **Gallery / Table layout toggle** | title "Gallery view" / "Table view" | Both plant screens use this pair. |
| **Editable cell** | `EditableCell` in `PlantDatabaseClient.tsx` | Inline cell editing (Enter saves, Esc cancels). |
| **Plant Reference** | `PlantReferenceClient` — `src/app/plant-reference/PlantReferenceClient.tsx`; NavBar **Plant Reference** | The **horticultural catalog** (`public.plants`, from the Obsidian PLANTS vault). |
| **Group tabs** | `GroupBtn` + `groupMode` | **Albums** (species albums), **All plants**, **Combinations**. |
| **Species album** | `inAlbumList` / `drill` | A species group whose cover is the **choice cultivar**'s photo; drilling shows that species' cultivars. |
| **Choice cultivar** | `plants.is_choice`; `/api/plants/[id]/choice` | The one starred cultivar per species; its photo becomes the album cover. |
| **Combination** | `Combination` — `src/lib/combinations.ts`; `CombinationCard`, `CombinationDetail`, `CombinationEditor` in `PlantReferenceClient.tsx` | A single photo of several plants growing together, linked to 1+ reference plants; it appears inside each linked species' album. "New combination" creates one. |
| **Filters** | `Chip`, `Toggle`, `Select` in `PlantReferenceClient.tsx` | Category chips (`PLANT_CATEGORIES`), **Any sun** (`SUN_OPTIONS`), **Any moisture** (`MOISTURE_OPTIONS`), **Native / Deer-resistant / Evergreen** toggles, sort (Name A–Z, Height low→high, high→low). |
| **Lock toggle** | title "Unlock to edit plants and photos" | Read-only guard; unlocked enables `PlantEditor`. |
| **Plant detail / editor** | `PlantDetail`, `PlantEditor`, `TEXT_GROUPS`, `BOOL_FIELDS` | Read view and "Edit plant" modal. |
| **Stamp card / stamp detail** | `StampCard`, `StampDetail` in `PlantReferenceClient.tsx` | Design symbols (perspective stamp / plan symbol) linked to a plant, shown inside its album. |

---

### 15. Tables browser — `/tables`

**Screen:** `src/app/tables/page.tsx` → `TableBrowserClient` — `src/app/tables/TableBrowserClient.tsx`. Styles: `src/app/tables/tables.module.css`.

| Term | Code identifier | What it is |
|---|---|---|
| **Sidebar** | `styles.sidebar`, `sidebarOpen`, `sidebarHead`, `sidebarCount`, `filterInput`, `tableList`, `tableItem`, `tableItemActive`, `tableItemName`, `tableItemMeta`, `viewBadge`, `scrim`, `menuButton` | Table list with "Filter tables…"; `view` badge marks read-only views. |
| **Header** | `styles.header`, `headerTitle`, `searchInput`, `filterToggle`, `filterToggleOn`, `filterCount` | "Search text columns…" + per-column filter toggle. |
| **Grid** | `styles.gridWrap`, `grid`, `row`, `rowNum`, `rowNumHead`, `sortButton`, `columnName`, `columnType`, `pkDot`, `sortArrow`, `numericCell`, `cellText`, `ellipsis`, `nullValue` | The data grid; column headers show type and FK target. |
| **Filter cell** | `styles.filterCell`; `OP_TITLES` | Per-column operator + value. |
| **Footer / pager** | `styles.footer`, `range`, `pager`, `pageSize`, `pageLabel` | Page size and paging. |

---

### 16. Photo Annotator (markup editor)

`PhotoAnnotator` — `src/components/PhotoAnnotator.tsx`; styles `src/components/photoAnnotator.module.css` (`toolBtn`, `active`, `utilBtn`, `textMove`, `opacityWrap`).

| Tool | Code identifier (`Tool` union) | What it does |
|---|---|---|
| **Pen** | `"pen"` | Freehand; hold still to snap to a straight line, keep holding (or Shift) to drop a polygon vertex, hold Option/Alt to bow the edge into a curve. |
| **Curve pen** | `"curvepen"` | Draw and hold still to smooth into a curve, drag to shape, hold to lock and chain another. |
| **Text label** | `"text"` | Skitch-style text pill; tapping the tool again toggles **move mode** (`styles.textMove`). |
| **Eraser** | `"eraser"` | Erase annotation pixels. |
| **Polygon fill** | `"fill"` | Draw edges, hold/Shift for corners, lift to close and fill. Has its own **Fill opacity** slider (`styles.opacityWrap`). |
| **Prism** | `"prism"` | Draw a polygon like fill, then press and drag up/down to extrude it. |
| **Ellipse** | `"ellipse"` | Drag a box to size a circle/ellipse. |
| **Rectangle** | `"rectangle"` | Drag a box to size a rectangle. |
| **Swatches** | `SWATCHES` | 6 colors; picking one also jumps back to the pen. |
| **Sizes** | `SIZES = [3,7,15]` / `TEXT_SIZES` | Fine / Medium / Thick. |
| **Line styles** | `LINE_STYLES` | solid / dashed / dotted. |
| **Sticker** | "Add image / sticker" (`utilBtn`) | Drop an image layer onto the photo. |
| **Undo / Redo** | `utilBtn` titles; `MAX_UNDO = 20` | Also one-finger double-tap = undo, two-finger double-tap = redo. |
| **Dictate caption** | mic `utilBtn` | Web Speech dictation into the caption. |
| **Palm rejection** | `PEN_LOCK = 1000` | 1s lock-out after an Apple Pencil stroke lifts. |

---

### 17. VoiceMap — `/voicemap`, `/voicemap/search`, `/voicemap/ask`, `/voicemap/wiki`, `/voicemap/wiki/[topic]`

| Term | Code identifier | What it is |
|---|---|---|
| **VoiceMap** (screen) | `src/app/voicemap/page.tsx` | Read-only viewer of VoiceMap sessions + cards synced in via `/api/voicemap/sync`. |
| **Session** | `VoiceMapSessionMeta` — `src/lib/voicemap.ts` | One brainstorming session; renders as a heading with its cards beneath. |
| **Card** (node) | `VoiceMapNode` — `src/lib/voicemap.ts` | A single idea node with `parent_id`, `label`, `summary`, `status`. Rendered recursively (cycle-guarded). |
| **Topic** | root ancestor of a card; `src/lib/voicemapWiki.ts` | A top-level card; each topic gets one wiki page. |
| **Reindex cards** | `ReindexCards` — `src/app/voicemap/ReindexCards.tsx` | Populates node embeddings by looping `/api/voicemap/embed`. Only re-embeds changed cards. |
| **Search cards** | `src/app/voicemap/search/page.tsx` | Semantic search ("Search by meaning, not just keywords…") via the `voicemap_match_nodes` RPC. |
| **Ask** | `AskClient` — `src/app/voicemap/ask/AskClient.tsx` | "Ask your second brain…" RAG question box. |
| **VoiceMap Wiki (index)** | `src/app/voicemap/wiki/page.tsx` | Every topic with build state: built / up to date / has new cards. |
| **Wiki page** | `src/app/voicemap/wiki/[topic]/page.tsx`, `WikiMarkdown.tsx` | The synthesized markdown for one topic, plus **History** (versions). |
| **Rebuild** | `WikiRebuild` — `src/app/voicemap/wiki/WikiRebuild.tsx`; `/api/voicemap/wiki/rebuild` | Regenerates a topic's page from its cards. |

---

### 18. Agent Ops — `/agent-ops` and children

Reference doc: `docs/agent-ops.md`. Styles: `src/app/agent-ops/agentOps.module.css`.

| Term | Code identifier | What it is |
|---|---|---|
| **Console** | `src/app/agent-ops/page.tsx` | The Agent Ops home: Needs you, How-to `<details>` (`styles.howto`), Agents tiles, shared documents. |
| **Agent tile** | `styles.tile`, `tileHead`, `tileName`, `tileRole`, `counts`, `dotLive`/`dotStale`, `tileFoot`, `bad` | One registered agent with queued / in-flight / failed counts, heartbeat, brief version. |
| **Needs you** (a.k.a. Human Action Inbox) | `HumanActionInbox` — `src/app/agent-ops/HumanActionInbox.tsx`; `styles.inbox`, `inboxItem`, `inboxHead`, `inboxTitle`, `inboxBody`, `inboxMeta`, `heldBlock` | Tasks with `requires_human`. Items not yet reworded by `project-manager` are **held**, with a **Release** action. |
| **Agent detail** | `src/app/agent-ops/[identity]/page.tsx`; `styles.columns`, `column`, `card`, `cardHead`, `back` | One agent: its brief, documents, and apps. |
| **Brief editor** | `AgentBriefEditor` — `src/app/agent-ops/AgentBriefEditor.tsx`; `styles.field`, `fieldLabel`, `fieldHint`, `actions`, `saved` | "Brief v\<n\>". Fields (`agent_prompts`): identity, mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules, plus "Why this change" (`change_note`). |
| **History / version diff** | `styles.versions`, `version`, `versionHead`, `versionNo`, `versionMeta`, `versionNote`, `versionBody`, `diff`, `diffWas`, `diffNow` | `agent_prompt_versions` snapshots, field-by-field was/now, with rollback. |
| **Copy brief** | `copyBrief` in `AgentBriefEditor.tsx`; `CopyAppBrief` — `src/app/agent-ops/apps/[slug]/CopyAppBrief.tsx` | Builds one markdown block a session can paste to become that agent (or that agent pointed at one app). |
| **New agent** | `NewAgent` — `src/app/agent-ops/NewAgent.tsx` | Name / Role / Mandate; writes both the registry row and the brief. |
| **Documents** | `AgentDocuments` — `src/app/agent-ops/AgentDocuments.tsx`; `styles.docList`, `docRow`, `docRowOpen`, `docTitle`, `docSummary`, `docMeta`, `docEditor`, `groupLabel`, `tag` ("all agents"), `attachRow` | An agent's shelf, or on the console the **Shared documents** shelf ("Filed under no agent" / "Applies to every agent"). |
| **Queue** | `QueueClient` — `src/app/agent-ops/queue/QueueClient.tsx`; `styles.queue`, `queueHead`, `queueIntent`, `queueId`, `queueRoute`, `queueState`, `queueBody`, `queueError`, `queueFacts`, `queueJson` | The bus (`agent_queue`) made readable: state chips, per-agent chips (`styles.chip`/`chipOn`/`chipCount`), **Reap** stuck rows. |
| **Apps** | `AppList` — `src/app/agent-ops/apps/AppList.tsx`; `AppDetails` — `src/app/agent-ops/apps/[slug]/AppDetails.tsx`; `AppIcon.tsx`; `styles.appRow`, `appRowText`, `iconRow`, `iconActions` | Every app `app-developer` builds: Name, Repo (owner/name), Live URL, Status (active/archived), Summary, Icon. The slug is the URL and isn't editable. |

---

### 19. Settings — `/settings`

`src/app/settings/page.tsx`; styles `src/app/settings/settings.module.css` (`card`, `cardHead`, `toggleRow`, `toggleSub`, `toggleHint`, `toggleError`, `saveNote`, `saved`, `sliderRow`, `sliderControl`, `grid`, `item`, `inputWrap`, `unit`, `toolLink`).

| Setting card | Code identifier | What it does |
|---|---|---|
| **Tile mode** | `TileModeSetting` — `src/app/settings/TileModeSetting.tsx`; `TILE_MODE_KEY = "app_tile_mode"` in `src/lib/appSettings.ts`; `useTileMode` — `src/lib/useTileMode.ts` | "Turn on Tile mode" — replaces the home page with the Launch Pad and hides the NavBar. Mirrored to `localStorage` key `app.tileMode`; broadcasts `voicedata:tile-mode`. |
| **Default effort per deal** | `StageDefaultsEditor` — `src/app/settings/StageDefaultsEditor.tsx`; table `stage_effort_defaults` | Hours per stage, feeding the scheduler/forecast. |
| **Sales Board view** | `SalesBoardViewSetting` — `src/app/settings/SalesBoardViewSetting.tsx`; `SALES_BOARD_HOVER_PHOTO_KEY`, `SALES_BOARD_HOVER_PHOTO_WIDE_KEY` | "Show key property photo on hover" and its sub-option "**Wide screen**" (draw it in a pane after the last column instead of floating it). |
| **Outlook calendar overlay** | `OutlookCalendarSetting` — `src/app/settings/OutlookCalendarSetting.tsx`; `OUTLOOK_ICS_KEY`, `OUTLOOK_OPACITY_KEY` | Published .ics URL + **Overlay strength** slider (10–100). |
| **Keyboard shortcuts** | `KeyboardShortcuts` — `src/app/settings/KeyboardShortcuts.tsx`; `GROUPS`; `styles.shortcutGroups`, `shortcutGroup`, `shortcutGroupTitle`, `shortcutList`, `shortcutRow`, `shortcutDesc`, `keys`, `kbd` | The canonical in-app shortcut reference, grouped: Global, Sales Board, Calendar, Next Actions, Tasks, Photos, Plant Database, Properties, Photo Annotator, Estimator (takeoff), Design tool. |
| **Maintenance** | `styles.shortcutsCard` block in `page.tsx` | Links to **Image backfill →**. |

---

### 20. Login and admin utilities

| Screen | Code identifier | What it is |
|---|---|---|
| **Login** | `src/app/login/page.tsx` → `LoginForm` — `src/app/login/LoginForm.tsx` | "Ricci's Landscape Management — Enter the shared password to continue." Single password field; sets the gate cookie via `/api/auth/login`, then hard-navigates to `?next=`. |
| **Aspire session** | `src/app/admin/aspire-session/page.tsx` → `AspireSessionClient.tsx` | Sections **Readiness**, **Last failure**, **Store a session** (paste `ASP.NET_SessionId=…`). Holds the encrypted Aspire session that "Find in Aspire" signs in with. |
| **Geocode backfill** | `src/app/admin/geocode-backfill/page.tsx` → `GeocodeBackfillClient.tsx` | One-time batch geocoder for jobsite addresses (Nominatim ~1 req/s). |
| **Image backfill** | `src/app/admin/image-backfill/page.tsx` → `ImageBackfillClient.tsx` | "Image compression backfill" — recompress stored deal & plant photos; dry run, archive originals, download, purge. |

---

### 21. Domain vocabulary

#### 21.1 Pipeline

| Term | Code identifier / table | Definition |
|---|---|---|
| **Deal** (preferred) / "Sales Board row" / "job" | `Deal` — `src/lib/salesBoard.ts`; table `public."Sales Board"` | One sales opportunity. Prefer **deal**; "Sales Board row" only when talking about the table. |
| **Stage** | `STAGES` / `Stage` — `src/lib/salesBoard.ts`; column `stage` | `Lead → Propose → Sent → Sold → Project Management → Invoiced → Paid in Full`. |
| **Lead** | `"Lead"`; key date `rfp_date` | A request came in; the RFP date is its date. |
| **Propose** | `"Propose"`; key date `appointment_date` | An appointment is booked / being run. |
| **Sent** | `"Sent"`; key date `proposal_date` | The proposal has gone out; this column also gets the **FU** (last follow-up) sort. |
| **Sold** | `"Sold"`; key date `won_date` | Won. Dragging Sent → Sold stamps today's won date and opens the internal SOLD email. |
| **Project Management** | `"Project Management"`; key dates `start_date`/`end_date` | Scheduled production. Its window is the all-day **Production bar** on the Calendar. |
| **Invoiced** / **Paid in Full** | `invoiced_date`, `paid_date` | The last two stages. |
| **Stage color** | `--c-lead / --c-propose / --c-send / --c-sold / --c-pm / --c-invoiced / --c-paid` (globals.css); `STAGE_COLORS` in `SalesBoardClient.tsx`, `TileLauncher.tsx`, `planning/blocks.ts` | One palette shared by board, tiles, launcher, planner, calendar, and map pins. |
| **Lost** | `lost_at`; `status` = Open/Closed | A deal marked lost. Hidden from the board unless flagged. |
| **Flag / loose end** | `flagged`; `styles["card-flag"]`, `modal-flag`, `tile-flag` | A deal that needs tying up. Flagging forces `status = Open` and keeps a lost deal visible. Set from the card swipe, the deal modal, dropping onto the Loose ends panel, or ⌘↵ in the command palette. |
| **Board order / arranged order (☰)** | `board_order` | Hand-arranged position within a stage, written by MasterDash's job board and read here. |
| **Proposal #** | `proposal_number` | Aspire proposal number; the key for "Find in Aspire". |
| **Proposal link / Aspire link** | `aspire_link` (label "Proposal link") | Resolved-and-cached Aspire proposal URL. |
| **Aspire opportunity link** | `opportunity_link` | Opened by long-pressing a deal card. |
| **Proposal description** | `proposal_description` | Short job description shown with the Descriptions toggle. |
| **Value / Pipeline / Paid in full** | `value`; stat tiles in `SalesBoardClient.tsx` | Deal amount, and the topbar sums of it. |

#### 21.2 People and places

| Term | Table / column | Definition |
|---|---|---|
| **Property** (a.k.a. jobsite) | `public.properties`; `Property` in `src/lib/salesBoard.ts` | One address. Deals at the same address share one property row — that's what makes repeat customers work. |
| **Contact** | `public.contacts`; `properties.primary_contact_id` | A property's single primary contact, shared by every deal there. A deal has no contact of its own. |
| **Cover photo** (album cover) | `properties.cover_photo_id` | The photo shown on the album tile, deal-modal header, hover preview, and deal tile. Falls back to `property_fallback_photos()` RPC. |
| **Next-action photo** | `properties.next_action_photo_id`; `photo_type = "Action_Photo"` | The ⚡ photo surfaced on Next Actions / Action Photos. One per deal — a new one replaces the old. |
| **Geocoded** | `properties.latitude/longitude/geocoded_at` | Coordinates from Nominatim; drives the calendar's photo→deal matching and the map. |
| **Email** (forwarded-in) | `Email` — `src/lib/salesBoard.ts`; `/api/emails/inbound` | An email forwarded to the inbound address, matched to a contact → property. Read-only in the deal modal's Emails list. |

#### 21.3 Events, photos, media

| Term | Code identifier | Definition |
|---|---|---|
| **Event** | `public.events`; `Event` — `src/lib/events.ts` | A block of time at a jobsite. Auto-created by clustering geotagged photos (same location, gaps ≤ 1 hour — `src/lib/photoEvents.ts`) or made by hand. |
| **Event type** | `EVENT_TYPES` — `src/lib/events.ts`; column `event_type` | `Appointment`, `Consultation`, `Design`, `Estimating`, `Meeting`, `Job`, `EOM`, `Other`. |
| **Photo** | `public.deal_photos`; `DealPhoto` — `src/lib/salesBoard.ts` | A photo or video. Junction-ish: FKs to `events`, `"Sales Board"`, `properties`, and `tasks` — which is why the app never does cross-table embeds through it. |
| **photo_type** | `PhotoType` — `src/lib/salesBoard.ts` | `null` = ordinary jobsite photo; `Site_Plan_Image` = the estimator's site plan (deal, no event); `Property_Reference` = general property reference (no event, no deal); `Video_Walkthrough` = a Video Snapshot recording (badge **WALK-THRU**); `Action_Photo` = a deal's ⚡ next-action photo (deal + task, no event). |
| **Outlier** | `deal_photos.is_outlier`; `outlier-badge` ⚠ | Dated differently from the rest of its event. |
| **Poster** | `poster_path` | Video thumbnail. |
| **Bucket** | `deal_photos.bucket` | Non-default storage bucket (e.g. `upright-media` for Upright site-session pins referenced without copying bytes). |
| **Annotated / original** | `original_storage_path` | Set when `storage_path` points at an annotated composite; keeps the un-annotated original so "Revert" works. |
| **Attachment** | `DealAttachment`; deal `attachments` | A PO or receipt (image or PDF) attached directly to a deal. |
| **Correspondence** | `DealCorrespondence`; `CorrespondenceChannel` = `call | email | text` | Either a logged touchpoint (channel + optional `body` note) or a screenshot (`storage_path`); `parent_id` makes a screenshot a child of a touchpoint. |
| **Transcript** | `DealTranscript`; `deal_transcripts` | An appointment transcript on a deal, optionally `event_id`-linked to its Appointment event. Imported by the `plaud-transcript-import` skill. |
| **Last follow-up (FU)** | `lastCorrespondenceTime()` in `SalesBoardClient.tsx` | Most recent correspondence timestamp; a deal with none ranks most overdue. |

#### 21.4 Tasks and next actions

| Term | Code identifier | Definition |
|---|---|---|
| **Task** | `Task` — `src/lib/tasks.ts`; `public.tasks` | Title, optional deal, context, start date, duration, completion. |
| **Next action** | `tasks.is_next_action`; surfaced as `deal.next_action` | The one task per deal designated as its next action (partial unique index). Replaces the old free-text field. |
| **Task context** | `TASK_CONTEXTS` — `src/lib/tasks.ts` | `Office`, `Field`, `Phone`, `Design`, `Errand`, `Waiting`. |
| **Task photo** | `TaskPhoto`; bucket `task-photos` | Photos attached to a task. |
| **Action list chip** | `verbOf()` / synonym groups in `NextActionsClient.tsx` | A filter chip built from the leading verb of next actions in view. |
| **Milestone** | `MILESTONES` — `src/app/next-actions/DealTimeline.tsx` | Appointment 🏠, Proposal Sent 📤, Sold 🤝, Production 🚧, Invoiced 🧾, Paid in Full 💰 — date-driven from the deal's own columns, not from events. |

#### 21.5 Planning / scheduling

| Term | Code identifier | Definition |
|---|---|---|
| **Planning block** | `PlanningBlock` — `src/lib/planning/blocks.ts`; `public.planning_blocks` | A typed, faded "intent" window on the calendar tied to a stage. Capacity = its duration. |
| **Block kind** | `BlockKind` = `one_off | recurring` | One-off has `blockDate`; recurring has `weekdays` + optional `startsOn`/`endsOn` and `excludedDates`. |
| **Detach** | `detachBlock()` in `CalendarClient.tsx`; `/api/planning/blocks/[id]/detach` | Dragging one occurrence of a recurring block turns it into a standalone one-off and adds the date to `excludedDates`. |
| **Block window** | `BlockWindow` — `src/lib/planning/schedule.ts` | One dated instance of a block, with `capacityHours`. |
| **Placement** | `Placement`; `public.planning_placements` (`deal_id`, `block_id`, `date`, `position`) | A pinned, manual assignment of a deal to a block instance. Un-pinned deals are placed by the scheduler. |
| **Assignment / forecast** | `Assignment`, `computeSchedule()` — `src/lib/planning/schedule.ts` | The recomputed-live FIFO packing of deals into block windows. Effort = `estimated_hours` or the stage default. |
| **Board issue** | `BoardIssue` — `src/lib/planning/board.ts` | `unplaced`, `oversized`, `needsEstimate` — the three red-chip states on the Planner. |
| **Stage effort default** | `public.stage_effort_defaults` | Hours per stage, set in Settings. |
| **Production window** | `Deal.start_date` / `end_date`; "Production start day" / "Production stop day" | The all-day work window; drawn as a Production bar on the Calendar and a PM tile on the Planner. |

#### 21.6 Master catalog / estimating

| Term | Code identifier / table | Definition |
|---|---|---|
| **Material** | `MATERIAL_CATEGORIES`, `MATERIAL_UNITS` in `MasterCatalogClient.tsx`; `/api/estimator/master` | A purchasable input with a cost per unit; shared across contexts. |
| **Application** | coverage rows under a material (`COVERAGE_UNITS`, `COVERAGE_METHODS`) | How a material is applied — coverage per unit, divide/multiply. |
| **Equipment** | `EQUIPMENT_CATEGORIES` = `small_equipment | large_equipment` | Machines an assembly needs. |
| **Assembly** | `ASSEMBLY_STAGES`, `UNITS_OF_WORK` | A recipe combining materials + equipment for one unit of work (`sq_ft`, `ln_ft`, `ton`). |
| **Kit** (assembly kit) | `useAssemblyKits` / `AssemblyKitModal.jsx`; `estimator_kits` | A saved take-off group you can re-apply, with a default takeoff type and plan annotation color. |
| **Phase** / **stage** (estimating) | Gallery tab **Phases**; `ASSEMBLY_STAGES` = `bed_installation`, `excavation`, `lawn_install`, `outcropping`, `patio`, `planting`; `/api/estimator/phases` | Operation phase used for the estimate's "By phase" breakdown. Note this is a *different* "stage" from the pipeline stage — say "estimating phase" to disambiguate. |
| **Take-off group** | `TakeOffGroupRow.jsx`; `estimate.groups` | A labelled group of estimate lines, optionally driven by a plan shape (area / linear / face-ft). |
| **Take-off** | `updateTakeoff` in `EstimatorApp.jsx` | The measured quantity behind a group. |
| **Plan shape / plant / item placement** | `PlanShapeList.jsx`, `PlanCanvas.jsx`; `estimate.plan.shapes` | Drawn areas/lines and placed plan symbols on the plan image. |
| **Calibrate / pixels per foot** | `handleSetScale`, `onSetPlanScale` | Two clicks on a known distance to set the plan's real-world scale. |
| **Aspire catalog** | `aspire_catalog` table; `/api/aspire-catalog/import`, `/suggest` | Imported CSV of Aspire's items, used to map master materials to exact Aspire names. |

#### 21.7 Agent Ops

| Term | Table / code | Definition |
|---|---|---|
| **Agent** | `agent_registry`; `docs/agent-ops.md` | One of the seven lanes: `project-manager`, `scheduler`, `librarian`, `correspondence-manager`, `mobilization-manager`, `master-estimator`, `data-ingestor`. |
| **Brief** | `agent_prompts` (+ `agent_prompt_versions`) | The agent's identity as data: mandate, owned/readonly resources, run loop, escalation rules, handoff rules, version. |
| **Queue** (the bus) | `agent_queue`, view `agent_queue_live`; `/agent-ops/queue` | One row per durable agent-to-agent request. Agents never call each other; they claim rows. |
| **Reap** | `/api/agent-ops/queue/reap` | Releases rows stuck in flight. |
| **Inbox** ("Needs you", Human Action Inbox) | `tasks.requires_human` / `human_instructions` / `instructions_reviewed_at` / `created_by_agent`; view `human_action_inbox` | What the agents handed back to Ryan. Held items await `project-manager` rewording; **Release** sets `instructions_reviewed_at`. |
| **Document** | `/api/agent-ops/documents`; `is_global` | Markdown filed under an agent, an app, or nobody ("Applies to every agent"). |
| **App** | `/api/agent-ops/apps`; `slug` | A project `app-developer` builds — name, repo, live URL, status, icon, documentation. |
| **Log** | `agent_log` | Append-only shared history so an agent can learn what happened while it wasn't running. |

#### 21.8 VoiceMap

| Term | Code | Definition |
|---|---|---|
| **Card / node** | `VoiceMapNode` — `src/lib/voicemap.ts` | One idea, with a `parent_id` tree. |
| **Session** | `VoiceMapSessionMeta` | One brainstorming session's worth of cards. |
| **Topic** | root ancestor of a card | A top-level card; the unit a wiki page is built for. |
| **Wiki page / version** | `src/lib/voicemapWiki.ts`; `/voicemap/wiki/[topic]` | Synthesized markdown for a topic, versioned with History. |
| **Reindex** | `/api/voicemap/embed` | Populates node embeddings so semantic search works. |

---

### 22. Ambiguity cheat sheet

| If he says… | He probably means | Disambiguate with |
|---|---|---|
| "tile" | Launch Pad tile, Sales Board **Tiles view** deal tile, Master Catalog gallery tile, plant/album tile, or Planner **PM tile** | "Launch Pad tile", "deal tile", "catalog tile", "album tile", "planner tile" |
| "album" | a **property's** photo group on `/photos` | "photo album" (preferred) vs "property photo group" (same thing) |
| "stage" | pipeline stage (`STAGES`) | vs "estimating phase" (`ASSEMBLY_STAGES` / Master Catalog **Phases** tab) |
| "board" | Sales Board Kanban | vs "Planner board" (`styles.board` in `planner.module.css`) vs "job board" (MasterDash, writes `board_order`) |
| "timeline" | the six-milestone `DealTimeline` | appears both in the deal modal footer and as the Next Actions first column |
| "photo strip" | deal modal's property-wide `deal-photo-strip` | vs Next Actions row `photo-strip` vs Tasks `task-photo-strip` |
| "plan" | Estimator **Plan view** (takeoff canvas) | vs Design **Plan view** (2D symbol layout) vs `Site_Plan_Image` |
| "stamp" | Design tool plant/object stamp | vs Photo Annotator "sticker" |
| "lightbox" | Photos lightbox | Calendar has its own (`lightbox-panel` in `calendar.module.css`) |
| "next action" | the deal's designated task | vs "**Action Photos**" screen vs the ⚡ next-action photo |
| "catalog" | Master Catalog (`/master-catalog`) | vs the legacy Estimator's **Catalog panel** |
| "plants" | `/plants` = design stamp library | vs `/plant-reference` = horticultural catalog |
| "tools" | the deal modal's **Tools** row (estimate + designs) | vs the Design toolbar's tool modes vs the Photo Annotator tools |

---


## MasterDash — "Quick Estimator"

Repo: the MasterDash repo. Docs: `README.md` (3,868 lines).

### Domain vocabulary

| Term | Code identifier | What it is |
|---|---|---|
| Job / deal | `deal`, `deal_id`, `attachDeal()` — `lib/estimator/jobBoard.ts` | A row of live work in one of four pipeline stages. "Job" on screen, `deal` in code. |
| Estimate | `Estimate` — `lib/estimator/types.ts:178` | The document being built: a log of taps plus a plan, a visit, settings. Saved by client id. |
| Tap / tap op | `TapOp` — `types.ts:113`; `tap_key` | One commit of one purchase increment. The only way a quantity enters the estimate. |
| Purchase increment / load | `materials.units_per_load`; README "One tap is a load, not a unit" (`README.md:475`) | The amount Ricci's actually buys — 8 cy of mulch, 5 ton of stone. There is no quantity entry anywhere. |
| Assembly | `AssemblyModel`, `ASSEMBLY_MODELS` — `lib/estimator/assemblies.ts` | A priced recipe (mulch bed, patio, French drain) whose loads are computed from coverage rates. |
| Bucket | `takeoff()`, "bucket maths" — `assemblies.ts` | One assembly-load's worth of work (520 sq ft of mulch bed, 100 sq ft of patio). Floored, never rounded up. |
| Tile tree | `TileNode` — `types.ts:61`; `lib/estimator/tree.ts` | The committed catalog snapshot the grid draws from — the offline floor. |
| Take-off shape | `PlanShape`, `ShapeKind = "area" \| "linear"` — `lib/estimator/plan.ts:39,87` | A bed or a run drawn on the Plan map. Adds loads, never a raw measurement. |
| Layer | `mapLayers.ts`, `planImage.ts`; LAYERS card `PlanPage.tsx:3906` | A georeferenced image (plan drawing or site photo) placed over the satellite. |
| Anchor | `setPlanAnchor()`, "the anchor" — `mapLayers.ts`; `README.md:3368` | The locked home view of the Plan, tied to the yard it was locked at. |
| Finding | `VisitFinding`, `FindingKind` — `lib/estimator/visit.ts:15,50` | One extracted line from a visit transcript: `match`, `unpriced`, `implied`, `ambiguous`, `note`. |
| Visit | `VisitState`, `VisitSource` — `visit.ts:73,81` | The transcript of a site visit plus what was read out of it. Joins to an Upright session by `sessionId`. |
| Survey | `lib/estimator/survey.ts`; SURVEY card `PlanPage.tsx:3825` | Upright's elevation points drawn under the take-off. A port of Upright's `elevationOf()` / `slopeOf()`. |
| Cultivar / plant | `PlacedPlant` — `plan.ts:236`; `plants.ts`, `plantStamp.ts`, `plantMass.ts` | A named plant symbol stamped on the plan; prices as its generic parent. |
| Call-out | `PhotoCallout` — `plan.ts:275` | A photograph held open on the plan with a leader line back to its dot. |
| Proposal | `buildProposal()` — `lib/estimator/proposal.ts`; `app/proposal/page.tsx` | Taps and buckets resolved into priced lines with derived deliveries. |

### Screen: Job board (`/`)

`components/estimator/JobBoard.tsx`, `lib/estimator/jobBoard.ts`, `README.md:44–390`

| Term | Code identifier | What it is |
|---|---|---|
| Job board **(preferred)** / board | `JobBoard.tsx` | The first screen: one tile per live deal, paged by stage. Nothing scrolls. |
| Job tile | `tilePicture(deal, photoBroken)` | A square tile drawn as a picture of the yard — cover photo, then satellite, then glyph. Identical geometry to a grid tile. |
| Stage row / stage chips | stages `Propose \| Sent \| Sold \| Project Management` (`JobBoard.tsx:110`) | The row above the board; tapping a stage jumps to its first page. Counts each stage; no longer filters. |
| Page dots | `boardPages()`, `keepPage()` | How far across one stage's run of pages you are. |
| Page swipe | pointer gesture, 60px threshold | Commits on release; a mostly-vertical drag does nothing. |
| Arrange mode | `Arrange` / `Done` button (`JobBoard.tsx:418`) | Drag tiles to reorder; the page swipe stands down while it is on. |
| Tile size control | `Bigger` / `Smaller` (`JobBoard.tsx:403–406`), `settings.tileSize` | Same setting as the grid's — the two grids are deliberately one size. |
| Property match line | `estimateForDeal()` | Sub-line reading *estimate started — matched by property* when the pairing was inferred, not stored. |

### Screen: Tile grid (`/`, after a job is chosen)

`components/estimator/TileGrid.tsx`, `EstimateTile.tsx`, `TileOptionsSheet.tsx`, `app/page.tsx`

| Term | Code identifier | What it is |
|---|---|---|
| Tile grid **(preferred)** / the grid | `TileGrid.tsx` | The POS-style grid of estimate tiles. Tap commits, long press refines. |
| Estimate tile | `EstimateTile.tsx` | One catalog item or folder. Dim until tapped; carries count, badge, price. |
| Tap / long press | `LONG_PRESS_MS = 500`, `MOVE_TOLERANCE_PX = 12` (`EstimateTile.tsx`) | Tap = one purchase increment. Long press = drill down, or back off one where there is no depth. |
| Depth shadow | README `README.md:390` "Two gestures, all the way down" | The darker drop shadow marking a tile that has something behind it. No chevrons. |
| Edit mode | `TileMode = "normal" \| "edit"` (`types.ts:87`); `DRAG_THRESHOLD_PX = 10` | Tiles wiggle; drag reorders, tap opens options. Entered by long-pressing empty space or the **Edit** button. |
| Tile options sheet **(preferred)** / options sheet | `TileOptionsSheet.tsx` | Modal over the grid; its one section today is **PHOTO** — Choose photo / Paste / Remove, drag-and-drop, ⌘V. |
| Reveal control / reveal chips | `Reveal = "none" \| "picked" \| "all"` (`types.ts:243`); labels `Collapsed` / `Picks` / `All` (`app/page.tsx:850`) | One control for the whole grid's folder state. Header, right. |
| Tile size toggle | `Bigger` / `Smaller` (`app/page.tsx:965`) | Same `settings.tileSize` the board writes. |
| Jobs button | header, `app/page.tsx` | Always present; the way back to the board. |
| Assembly page | `AssemblyPage.tsx` | Opened by long-pressing an assembly tile: the itemised take-off and the machines the catalog says the work needs. |
| Hardscape & extras | `AssemblyPage.tsx` / `assemblies.ts` | Computed bucket for priced items belonging to no assembly. |

### Screen: Plan (map take-off)

`components/estimator/PlanPage.tsx` (5,020 lines), `PlanCanvas.tsx` (3,824 lines), `README.md:544–3530`

| Region | Term | Code identifier | What it is |
|---|---|---|---|
| Canvas | Plan canvas **(preferred)** / the map | `PlanCanvas.tsx` | Satellite basemap + georeferenced layers + shapes + plants + call-outs. Pinch/wheel to zoom, one finger to pan. |
| Tool row | Tool row / tools | `TOOLS` — `PlanPage.tsx:200` | `Select` ☝︎ · `Area` ⬟ · `Linear` ╱ · `Plant` 🌳 (`PlanTool`). |
| Tool row | Hint line | `HINTS` — `PlanPage.tsx:237` | The one line under the map saying what the next tap does. |
| Tool row | Plant mode | `PlantMode = "plant" \| "select" \| "delete"` (`plan.ts:191`), `PLANT_MODE_UI` (`PlanPage.tsx:216`) | The Plant button cycles **Plant → Pick → Remove**; the word is on the button. Remove is a sticky eraser drag. |
| Canvas | Tool ring **(preferred)** / the ring | `lib/estimator/toolRing.ts` — `wedgeAt()`, `RING_HOVER_MS=900`, `RING_INNER_PX=34`, `RING_OUTER_PX=92` | Apple Pencil hover ring of plant-category wedges. Arms a category; does not plant. Hole in the middle picks nothing. |
| Canvas | Ghost | `ringOrigin()`, `ringSettled()` | The translucent preview of the plant about to be stamped. |
| Canvas | Shape dots / midpoint handles | `PlanCanvas.tsx` | Corner handles reshape; the `+` midpoint splits a side. |
| Canvas | Shared corners | `title="Give this shape its own copies of the shared corners"` (`PlanPage.tsx`) | Corners two shapes hold in common. |
| Canvas | Curved / Straight edges | `lib/estimator/curve.ts`; `aria-label="Curved edges"` / `"Square corners"` (`PlanPage.tsx:2313,2323`) | Centripetal Catmull-Rom, derived from corners, never stored. `Round all` / `Straighten all` (`:4863`). |
| Canvas | Shape label | `LabelMode = "all" \| "name" \| "none"` (`plan.ts:160`); `aria-label="What is written on a shape"` | What each shape reads. Draggable off centre; `Label moved` / *put the label back in the middle*. |
| Canvas | Scale bar / Fit / padlock | `Lock in place` / `Unlock` (`PlanPage.tsx:4055`), `setPlanAnchor()` | Fit fits the drawing; the padlock beside it locks the current view as the plan's home. |
| Side column | Side column **(preferred)** / cards | `settings.sideCollapsed`; `aria-label="Fold or open every box"` (`PlanPage.tsx:3194`) | The stack of foldable cards: **PROPERTY**, **SURVEY**, **LAYERS**, **PLANTING**. |
| Side column | PROPERTY card | `PlanPage.tsx:3647`; `Change` / `Choose` (`:3682`) | Which yard the plan is at. States it; does not ask. |
| Side column | SURVEY card | `PlanPage.tsx:3825`; `Show` / `None` (`:3849–3855`) | Puts an Upright grade survey (anchor, points, slope runs) under the take-off. |
| Side column | LAYERS card | `PlanPage.tsx:3906`; `Bring forward` / `Send back` (`:3954,3963`) | Georeferenced images: `Place` / `Done placing`, `Lock in place` / `Unlock`, opacity, rotate. Drop a photo here to add one. |
| Side column | PLANTING card | `PlanPage.tsx:4339`; `aria-label="Plant symbols and sizes"` (`:4351`) | Per-category counts, `Clear`, and the symbols panel (line work, spread, mass). |
| Side column | Assembly colour panel | `aria-label="Assembly colours and visibility"` | Whether each assembly is drawn and in what colour; `Reset colours`. |
| Toolbar | Set scale / Rescale | `Set scale` / `Rescale` / `Cancel` (`PlanPage.tsx:2584`) | Ties the plan image to a known dimension. |
| Toolbar | Undo / Redo | `aria-label="Undo the last change to the plan"` (`PlanPage.tsx:2300`); `lib/estimator/multiTap.ts` — `multiTapAction()`, `MULTI_TAP_MS=600`, `MULTI_TAP_SLOP_PX=12` | Document-level undo. A double/triple tap on the canvas is the gesture shortcut. |
| Toolbar | Fullscreen map | `aria-label="Fullscreen map"` (`PlanPage.tsx:2408`) | The app's own fullscreen; the tools come with it, the other panes do not. Deliberately not remembered. |
| Toolbar | Satellite toggle | `title="Show or hide the satellite"` (`PlanPage.tsx:2437`) | |
| Filmstrip | Filmstrip **(preferred)** / photo rail | `ReviewPanel.tsx:802–807` — `Visit` / `Property` / `Reference` / `Plants` | The bottom rail of photo frames and the plant catalog, on one switch. Frames drag onto the map to become dots, call-outs or layers. |
| Overlay | Photo/Map switch | `Map` / `Photo` (`PlanPage.tsx:2863`) | Top left of the map once something is picked — an overlay, not a fourth pane. |
| Sheet | "Draw this bed" | `PlanPage.tsx:247` | An assembly plus the photographs of the thing, so a finished shape carries its own evidence. |

### Screen: Review

`components/estimator/ReviewPanel.tsx`, `useReviewAudio.ts`

| Term | Code identifier | What it is |
|---|---|---|
| Review panel | `ReviewPanel.tsx` | Play an Upright visit back beside the plan. |
| Transport bar | `Play` / `Pause` (`:1136`), `Playhead` (`:1147`) | |
| Show map / Show video | `:1163` | Swaps what the main pane holds. |
| Photo rail switch | `Visit` / `Property` / `Reference` / `Plants` (`:802–807`) | Which set of frames the rail shows. |
| Take-off link | `Link to a take-off` / `Detach from this take-off` (`:530,510`) | Tags a photograph with the shape it is a picture of. |
| Visit chooser | `Choose a visit` / `Change` (`:1298`), `No visit chosen.` (`:1291`) | |

### Screen: Visit

`components/estimator/VisitPage.tsx`, `lib/estimator/visit.ts`

| Term | Code identifier | What it is |
|---|---|---|
| Visit page | `VisitPage.tsx` | Paste or import a transcript, read findings out of it, accept them into the estimate. |
| Read the visit / Read again | `:198–199` | Runs the extraction. |
| Finding row | `VisitFinding.status = "pending" \| "accepted" \| "dismissed"` | Carries `label`, the `quote` it came from, the model's `detail`, and a `commit` when it can be added. |
| Stale findings | `findingsAreStale`, `extractedFrom` | Marked when the transcript has moved on since the read. |
| From Upright | `UprightImport.tsx:331` | Picks an Upright session as the visit's source. |

### Screen: Proposal (`/proposal`)

| Term | Code identifier | What it is |
|---|---|---|
| Proposal page | `app/proposal/page.tsx` | Priced lines, the job name, and the list of saved estimates. |
| Job name field | `Job name` (`:88`) | |
| Cost / Sell columns | `:208,222` | |
| Save state chip | `Held here` / `Waiting for signal` / `Saved on this device` (`:251–256`) | |
| Open an estimate | `:315` | The list of saved estimates. |

### Cross-cutting

| Term | Code identifier | What it is |
|---|---|---|
| Boot | `components/estimator/Boot.tsx` | Starts the offline cache, sync loop, photo queue, plan-image queue and live prices, on whatever screen you land on. |
| Autosave | `components/estimator/Autosave.tsx`, `flushAutosave()` | Writes the estimate from any screen that changes it. |

---

## Upright — site session (iPad)

Source: the Upright `main` branch (2026-08-31). Single-file `index.html` (11,824 lines); `CLAUDE.md` (2,712 lines). Line numbers below are against that branch.

### Domain vocabulary

| Term | Code identifier | What it is |
|---|---|---|
| Session | `startSession()`, `endSession()`, `finalizeSession()`; `upright_sessions` | One visit. A context, not a destination (`CLAUDE.md:1010`). |
| `sessionT0` | `sessionT0` | The session's zero time. Every clip, pin and transcript offset is measured against it — which is why audio can never restart mid-session (`CLAUDE.md:450`). |
| Clip | `startVideoClip()`, `stopVideoClip()`, `buildClipWithAudio()` | An independent H.264 video segment with its own offset (`CLAUDE.md:147`). |
| Pin | `addPinMarker()`, `capturePin()`, `selectPin()` | A photo pin: a picture plus a GPS position, draggable onto the map. |
| Sketch / Measure | `commitSketch()`, `commitMeasure()`, `clearMeasureDraft()` | Freehand drawing and a two-tap distance on the plan. |
| Observation / anchor / target | `nextShotIsObservation()`, `nextShotIsAnchor()`, `firstSightingObs()` | The three shot roles in a grade survey: where you stood, the 0.00' datum, and everything measured against it (`CLAUDE.md:1592`). |
| Set | `setsOf()`, `setResume()`, `setDelete()`, `set_observation_id` | One observation position plus the targets shot from it (`CLAUDE.md:1736`). |
| Shot | `gradeFire()`, `gradeSnapshot()`; `upright_elevation_shots` | One sighting: an angle, a dwell spread, and a camera frame with the crosshair burned in. |
| Elevation | `elevationOf()` | Derived live from where pins sit, never stored. Ported into MasterDash's `lib/estimator/survey.ts`. |
| Slope run | `slopeOf()`, `slopeAdd()`, `slopeArm()`; `upright_elevation_slopes` | A line between two points labelled with percent grade and fall. Arrow points downhill. |
| Object | `OBJ_TYPES` (`index.html:8624`), `objNextRole()`, `objShootOrder()` | A measured thing with a type; the type is a shoot order, not a label (`CLAUDE.md:2456`). |
| Plan georef | `planCorners()`, `planBounds()`, `applyKnownDimension()`, `plan_*` on `upright_sessions` | Centre lat/lng + width in metres + aspect + rotation — five numbers that rebuild the overlay exactly (`CLAUDE.md:1526`). |
| Take-off | `toggleTakeoff()`, `drawTakeoffs()`, `takeoffLabel()`, `GET /takeoff` | MasterDash's beds and runs drawn read-only as a reference layer (`CLAUDE.md:124`). |
| Fold | `foldsDraw()`, `foldMerge()`, `foldPlanSpans()` | Each drawing shown on the other view — plan strokes beaded under the anchor line in a section, section strokes cast onto the cut line on the plan (`CLAUDE.md:959`). |
| Surface | `surfMesh()`, `surfPoints()`, `surfaceDraw()`, `contourSegs()` | Contours and drainage flow derived from the ground points (`CLAUDE.md:889`). |
| Prefs | `prefs`, `savePrefs()`, `prefSet()` — `localStorage['upright.prefs']` | The only thing written to local storage; session data is RAM-plus-ZIP (`CLAUDE.md:744`). |

### Screen: Start

| Term | Code identifier | What it is |
|---|---|---|
| Start screen / start overlay **(preferred: start screen)** | `#startOverlay` `.stage-overlay` (`index.html:1609`) | "Record upright, map flat." |
| Recording-mode switches | `#recModes`, `#modeAudioBtn`, `#modeVideoBtn`, `#modeNote` (`:1614`) | Two independent switches, both on by default. Audio is one-way within a session (`CLAUDE.md:450`). |
| Start session button | `#enableBtn` `.go-btn` (`:1620`) | |
| Past sessions / Settings links | `#historyBtn`, `#settingsBtn` (`:1622–1623`) | |

### Region: Header (always on)

| Term | Code identifier | What it is |
|---|---|---|
| Header | `<header>` (`index.html:1360`) | |
| Live recording chips | `#recLive`, `#liveAudioBtn`, `#liveVideoBtn` `.rec-chip` (`:1363–1365`) | Mirrors the start screen's two switches for the rest of the session. Not in the map toolbar — that is invisible while the iPad is upright. |
| State pill | `#statePill` `.state-pill`, `#stateText`, `setState()` (`:1367`) | Says what is actually being captured: *Recording — audio only*, *Not recording — camera*. |
| End session button | `#endBtn` `.end-btn` (`:1369`) | |
| Archive Done button | `#archiveMapDone` (`:1372`) | The way out of a reopened past session, in the same corner. |

### Screen: Camera / upright

| Term | Code identifier | What it is |
|---|---|---|
| Stage | `#stage` `.stage` (`index.html:1375`) | The container everything lives in. |
| Camera view / preview | `#live` `<video>`, `startCamera()`, `wakeCamera()` (`:1376`) | Always runs regardless of the video switch. |
| Tilt readout / GPS readout | `#tiltReadout`, `#gpsReadout` (`:1377–1378`) | |
| Clock | `#clock`, `updateClock()` (`:1382`) | Session elapsed time. |
| Stage toast | `#stageToast` `.stage-toast`, `toast()` (`:1381`) | Progress and error lines that must not land off screen. |
| Shutter | `#snapBtn` `.snap-btn`, `shutterHoldStart()` / `shutterHoldEnd()` (`:1426`) | The round button. Snaps a photo pin at the current GPS position. |
| Snap flash | `#snapFlash` `.snap-flash` (`:1441`) | |
| Pin count | `#pinCount` `.pin-count`, `updatePinCount()` (`:1440`) | |
| SHOOT GRADE button | `#gradeBtn` `.grade-btn` (`:1427`), `gradeSetMode()` | Thumb button above the shutter; toggles grade mode and locks the flat/upright switch (`CLAUDE.md:1685`). |
| Annotation bar | `#annoBar` `.anno-bar` (`:1383`) — `#annoArrow`, `#annoSquare`, `#annoCircle`, `#annoX`, `#annoDraw`, `#annoColor` | Markers dropped on the live picture; ✎ snaps and opens the draw-over editor. |
| Annotation overlay | `#annoOverlay` `.anno-overlay`, `annoPaths()`, `drawAnnoOnCanvas()` | |
| Assembly column | `#asmCol` `.asm-col`, `assemblyArm()`, `assemblyBarSync()` (`:1438`) | Take-off tiles stacked up the right edge above the shutter (`index.html:697`). |
| Scale tracks | `#scaleX`, `#scaleY`, `#scaleD` `.scale-track` `.st-knob`, `stSetKnob()`, `syncKnobs()` (`:1418–1424`) | |

### Region: Sighting overlay / HUD

`#sightOverlay` `.sight-overlay` (`index.html:1394`), `sightDraw()`, `sightRefresh()`, `paintSight()`

| Term | Code identifier | What it is |
|---|---|---|
| Sighting overlay **(preferred)** / sighting HUD | `#sightOverlay` | Everything drawn over the camera while shooting grade. Stays open after a shot, offering *Shoot again* / *Done*. |
| Crosshair / sight cross | `#sightCross` `.sight-cross`, `#sightCrossGlyph` | Where the shot lands. |
| Sight message / prompt | `#sightMsg` `.sight-msg`, `objPrompt()` | The line saying what the next shot is. |
| Sight angle | `#sightAngle` `.sight-angle`, `sightAngleNow()` | |
| HOLD STEADY | `#sightSteady` `.sight-steady` | |
| Dwell bar | `.sight-dwell`, `#sightDwellFill`, `DWELL_MS`, `REARM_DEG` | Shots fire automatically on dwell, then disarm until you move off. |
| Object type pills | `#sightTypes` `.sight-types`, `objTypesBuild()`, `objTypesSync()` (`:1408`) | The type picker, above the compass. Tap the type you are on to end that object. |
| Compass rose | `#sightCompass` `.sight-compass`, `#scRose`, `#scBearing`, `#scAcc`, `roseBuild()`, `compassBearing()` (`:1409`) | The bearing, as evidence (`CLAUDE.md:1889`). |

### Region: Bed outline by aiming

`CLAUDE.md:203`, `outlineStart()` … `outlineFinishHere()`

| Term | Code identifier | What it is |
|---|---|---|
| Outline frame | `#outlineFrame` `.outline-frame` (`index.html:1428`) | The frozen picture you aim over. |
| Outline HUD | `#outlineHud` `.outline-hud` (`:1430`), `outlineRender()`, `outlineLabelSvg()` | The SVG of marked corners and lengths. |
| Detected edges | `#outlineEdges` `.outline-edges`, `outlineEdgesBuild()`, `outlineEdgesPaint()`, `outlineSnapAt()` | Camera-found boundaries; the cross snaps onto one within a thumb's width (`CLAUDE.md:359`). |
| Outline hint | `#outlineHint` `.outline-hint` | |
| Outline bar | `#outlineBar` `.outline-bar` (`:1432`) — `#outlineEdgesBtn` Edges, `#outlineRecentreBtn` Re-centre, `#outlineUndoBtn` Undo, `#outlineCancelBtn` Cancel | |

### Region: Draw-over editor

| Term | Code identifier | What it is |
|---|---|---|
| Draw-over editor **(preferred)** / draw wrap | `#drawWrap` `.draw-wrap` (`index.html:1442`), `openDrawEditor()`, `pauseRecForDraw()` | Full-screen editor over a snapped frame. |
| Draw canvas | `#drawCanvas` `.draw-stage` | |
| Swatches / Undo / Clear / Done | `#drawSwatches`, `#drawUndo`, `#drawClear`, `#drawDone` (`:1445–1449`) | |

### Screen: Map (iPad flat)

`#mapwrap` `.mapwrap` (`index.html:1452`), `initMap()`, `showMap()`

| Region | Term | Code identifier | What it is |
|---|---|---|---|
| — | Map view **(preferred)** / site map | `#map`, `#mapClip` `.map-clip` (`:1466`) | Leaflet over Esri World Imagery. |
| — | North needle | `#mapNorth` `.map-north`, `#mapNorthDial`, `mapRotApply()`, `mapRotSync()` (`:1469`) | Drawn outside the rotated container so it holds still on screen. |
| — | Esri credit | `.map-attrib` (`:1476`) | Static, because Leaflet's own attribution is hidden while the map is turned. |
| Left | Pin inspector **(preferred)** / preview column | `#pinInspector` `.pin-inspector` (`:1454`), `inspectOpen()`, `inspectSetOpen()`, `inspectRenderPin()`, `inspectRenderElev()` | The fixed left column describing whatever pin is under your finger — photo on top, everything known underneath. Not a Leaflet popup, on purpose (`CLAUDE.md:489`). |
| Left | Inspector head / title / close | `.pi-head`, `#piTitle` `.pi-title`, `#piClose` `.pi-close` | The × is a one-off close and leaves `prefs.inspector` alone. |
| Left | Inspector photo | `.pi-photo`, `#piImg`, `#piNoImg` `.pi-noimg` | |
| Left | Inspector body / rows | `#piBody` `.pi-body`, `piRow()`, `piCoords()`, `piFt()`, `piPhoto()` | Numeric rows are rewritten on every drag frame; the note field and download button are built once per pin. |
| Bottom | Mode bar | `#modeBar` `.mode-bar` (`:1478`) — `#modeMsg`, `#modeUndo` Undo, `#modeDone` Finish, `#modeCancel` Cancel | The bar for whatever map mode is armed (sketch, measure, plan scale). Lives inside `.mapwrap`, so invisible while upright. |
| Bottom | View switch | `#viewSwitch` `.view-switch`, `buildViewSwitch()` (`:1484`) | |
| Bottom | Filmstrip | `#filmStrip` `.film-strip` (`:1485`), `renderStrip()`, `panelsSync()` | The row of photo pins and grade frames. There is exactly ONE, re-parented between the map and an elevation view. |
| Bottom | Film thumb | `.film-thumb`, `.fnum`, `.film-thumb.sel`, `.film-thumb.nogps`, `.film-thumb.elev` (`index.html:1002–1058`) | One frame. `.nogps` = no position yet. |
| Bottom | Set group | `.film-set`, `.film-set-head`, `.film-set-name`, `.film-set-row`; `.is-hidden` / `.is-locked` | One outlined, named group per set, with round icon buttons for Hide/Show, Lock/Unlock, Delete, Add shots (`CLAUDE.md:1736`). |
| Bottom | Anchor box | `.film-set.is-datum` (`index.html:1026`, built at `:6271`) | The anchor's own group in the filmstrip, coloured `--anchor-sight`. Belongs to every set, carries its own lock. |
| Bottom | Survey bar **(preferred)** / elev bar | `#elevBar` `.elev-bar` (`:1486`) | Opens when grade mode ends. |
| Bottom | Elev pill / elev status | `#elevStatus` `.elev-status`, `elevStatusUpdate()` (`index.html:8398`) | The running line inside the survey bar. Rewritten cheaply during a drag so the drag survives. |
| Bottom | Slope button / Done | `#slopeBtn`, `#elevExit` (`:1489–1490`) | Slope arms the next two pin taps, then disarms. |
| Bottom | Map toolbar / plan toolbar | `.map-toolbar` (`:1492`) | Hidden while the map sits in review's mini pane. |
| Toolbar | Import plan | `#importPlanBtn`, `#planFile` (`:1493`) | |
| Toolbar | Overlay controls | `#overlayControls` `.overlay-controls` (`:1496`) — `#opSlider` Opacity, `#scaleSlider` Size, `#rotSlider` Rotate | Size is disabled once the scale is locked. |
| Toolbar | Set scale / Rescale | `#scalePlanBtn`, `applyKnownDimension()`, `parseFeet()`, `setMapMode('planscale')` (`:1500`) | Tap the two ends of a stated dimension and type what it really is. The button reads **Rescale** afterwards. |
| Toolbar | Lock / Unlock (plan) | `#lockPlanBtn`, `plan_scale_locked`, `isLocked()` / `setLocked()` (`:1501`) | Restored plans come back locked. |
| Toolbar | Take-off | `#takeoffBtn`, `toggleTakeoff()` (`:1503`) | MasterDash's beds and runs, read-only. |
| Toolbar | Export pins | `#exportPinsBtn`, `exportPins()` (`:1504`) | |
| Toolbar | My location | `#centerBtn`, `syncCenterBtn()`, `setGeoOn()`, `setHeadingUp()`, `deviceTopBearing()` (`:1505`) | Three-tap cycle: off → centred north up → centred heading up → off. A tap after the view has moved re-centres instead of advancing (`CLAUDE.md:689`). |
| Toolbar | Sketch / Measure | `#sketchBtn`, `#measureBtn` (`:1506–1507`) | |
| Toolbar | Elevation | `#elevBtn`, `evOpen()` (`:1508`) | |
| Toolbar | Section cuts | `#cutsBtn`, `cutsBuild()`, `cutLineAt()`, `cutHandleLL()`, `cutRotHandleLL()` (`:1509`) | The lines on the plan a section is taken along. |
| Toolbar | Grid / Align to grid | `#mapGridBtn`, `#mapAlignBtn`, `syncGridBtns()`, `gridDraw()`, `alignProject()` (`:1510–1511`) | |
| Toolbar | Fold | `#foldMapBtn`, `syncFoldBtns()` (`:1512`) | |
| Toolbar | Surface | `#surfBtn`, `syncSurfBtn()`, `surfaceDraw()` (`:1513`) | |
| Toolbar | Split | `#splitBtn`, `setSplit()` (`:1514`) | |
| Toolbar | Preview / Filmstrip | `#panelsMapBtn`, `#stripMapBtn` → `prefs.inspector`, `prefs.filmstrip` (`:1515–1516`) | Each toolbar carries both; Settings shows the same two. |
| Toolbar | Extent lock | `#lockExtentBtn` (`:1517`), `planBounds()` — reads **Unlock extent** when on (`index.html:11098`) | Pins the map to the plan's footprint and sets `minZoom` from it. |
| Toolbar | Basemap button | `#basemapBtn` (`:1518`), `applyBasemap()`, `basemapMode` | Cycles **Plan + satellite → Plan → Satellite** (`index.html:11139`, `CLAUDE.md:1526`). |
| Toolbar | Settings gear | `#settingsMapBtn` (`:1519`) | |
| Toolbar | Delete session | `#mapDeleteBtn` `.danger` (`:1522`) | Only on a session opened out of the history. |

### Screen: Split screen (section over plan)

`CLAUDE.md:553`

| Term | Code identifier | What it is |
|---|---|---|
| Split screen | `setSplit()`, `splitOrientationCheck()`, `prefs.splitPortrait`, `splitXform()`, `splitCan()` | Stand the iPad on its end while the map is up: section on top, plan underneath, turned to face that section. |
| Divider bar / split bar **(preferred: divider bar)** | `#splitBar` `.split-bar` (`index.html:1531`), `syncSplitBar()` | One shared row on the divider owning what belongs to both halves. |
| Section slot | `#sbSlot` `.sb-slot` | Which section is on top (the five-way switch moves here in split). |
| Sketch / Fold (shared) | `#sbSketch`, `#sbFold`, `splitSketchOn()`, `splitSketchSet()` | Neither half carries its own copy while split is up. |

### Screen: Elevation view (section)

`#elevPanel` `.elev-panel` (`index.html:1538`), `CLAUDE.md:2066`

| Region | Term | Code identifier | What it is |
|---|---|---|---|
| Bar | Section tabs | `#evTabs` `.ev-tabs` (`:1542`) — `#evTabTop` Top, then `data-side` North / South / East / West | The five-way switch. Hidden as a unit in split screen. |
| Bar | Lock / Fit | `#evLockBtn` `.ev-lock`, `#evFitBtn` | |
| Bar | Vertical exaggeration | `#evExagSlider` `.ev-exag`, `#evExagLabel` V.E., `#evExagVal`, `exagFromSlider()`, `evAutoExag()`, `prefs.vertExag` | Hidden while the preference is off; per-view settings are kept. |
| Bar | Elevation plan / Photo | `#evPlanBtn`, `#evPhotoBtn`, `#evPlanImg`, `#evPhotoImg`, `evPlaceImg()` | Images placed behind a section. |
| Bar | Grid / Sketch / Ground / Level lines | `#evGridBtn`, `#evSketchBtn`, `#evGroundBtn`, `#evLevels`, `groundProfile()`, `groundRun()` | Ground line joins the survey points along a cut, in order (`CLAUDE.md:848`). |
| Bar | Fold / X-ray | `#foldEvBtn`, `#evXray` | |
| Bar | Preview / Filmstrip / gear | `#panelsEvBtn`, `#stripEvBtn`, `#evSettingsBtn` | |
| Sketch bar | Sketch bar | `#evSketchBar` `.ev-sketchbar` (`:1563`) — swatches, `#evAlignBtn` Align to grid, `#evUndoBtn`, `#evClearSketch` Clear section, `#evDoneSketch` Done | `CLAUDE.md:2179` |
| Image bar | Image bar | `#evImgBar` `.ev-imgbar` (`:1574`) — `#evToolUniform` / `#evToolStretch` / `#evToolDistort`, `#evTiltV` Tip, `#evTiltH` Turn, `#evStraighten`, `#evOpacity` Fade, `#evResetImg` Reset shape, `#evClearImg` Remove image | `evKeystone()`, `evXformCorners()`, `evCornerHandles()` |
| Stage | Section stage | `#evStage` `.ev-stage`, `#evSvg` `.ev-svg`, `evRender()`, `evProject()`, `evGeom()` (`:1598`) | |
| Stage | Anchor line / datum | `evEnsurePivot()`, `evDefaultPivot()`; `index.html:10027`, `:10265` | The horizontal datum a section is read against. The vertical drag moves it; folded plan strokes bead *under* it, never on it. |
| Stage | Note / empty | `#evNote` `.ev-note`, `#evEmpty` `.ev-empty` | |
| Strip slot | Filmstrip slot | `#evStripSlot` `.ev-strip-slot`, `panelsSync()` (`:1606`) | Where the one filmstrip goes when an elevation view is up. |

### Screen: Session complete / done panel

`#donePanel` `.done-panel` (`index.html:1632`)

| Term | Code identifier | What it is |
|---|---|---|
| Done panel **(preferred)** / session screen | `#donePanel`, `showSessionScreen()` | One screen for a just-ended session and one opened out of the history alike. |
| Title / sub | `#doneTitle`, `#doneSub`, `sessionTitleOf()` | |
| Audio status / general status | `#doneAudio`, `#doneStatus` `.done-status` | Two lines on purpose — a lost recording must not be overwritten by a tagging report. |
| Open on map | `#openMapBtn`, `openArchiveMap()` | |
| Proposal from this visit | `#proposalBtn` → `#proposalPanel` | |
| Retry saving the audio | `#retryAudioBtn`, `renderAudioSave()`, `wireRetry()` | |
| Review session | `#reviewBtn`, `openReview()` | |
| Download audio recording | `#dlVideo` | |
| ZIP export | `#dlPins` "Download session (ZIP): audio + clips + pins", `buildAndSaveZip()`, `exportPins()` | Session data is RAM-plus-ZIP; this is how it leaves the device. |
| Name this session | `#nameSessionBtn` → `#namePanel` | |
| Delete session | `#deleteSessionBtn` `.danger`, `deleteSession()` | |

### Screen: Past sessions (history)

`#historyPanel` `.history-panel` (`index.html:1658`), `CLAUDE.md:2336`

| Term | Code identifier | What it is |
|---|---|---|
| Past sessions panel **(preferred)** / history panel | `#historyPanel`, `openHistory()`, `loadHistory()` | |
| List view / Tiles view | `#historyView` (label toggles `List` / `Tiles`), `historyViewSync()`, `prefs.historyTiles` | Tiles = a satellite preview of each property; the list keeps Name, Tag, Open, Delete, Match. |
| Map tile / session tile | `#histGrid` `.hist-grid`, `renderHistoryTiles()`, `mapPreviewInto()`, `tileXY()` | A little slippy map with no Leaflet in it, centred on the property. |
| Session list | `#histList` `.hist-list`, `renderHistory()` | |
| Multi-select delete **(preferred)** / pick mode | `#historySelect` Select, `histSetPicking()`, `histPickToggle()`, `histPaintPicks()`, `histDeleteChosen()`, `HIST_HOLD_MS = 500` | Arms a mode; a hold on a tile is the other way in. Tiles only. One pair of confirmations for the batch. |
| Pick bar | `#histBar` `.hist-bar` — `#histPickCount`, `#histPickAll` Select all, `#histPickDelete` Delete, `#histPickCancel` Cancel | |
| Refresh / Close | `#historyRefresh`, `#historyClose` | |

### Panels: property match, name, proposal, settings

| Term | Code identifier | What it is |
|---|---|---|
| Property match prompt **(preferred)** / property picker | `#propPanel` `.prop-panel` (`index.html:1679`), `openPropertyPicker()`, `assignProperty()`, `autoTagSession()`, `matchLine()`, `offerBackfill()` | "Choose property" — search, `#propClear` No property. Where two candidates cannot be separated, the honest answer is neither (`CLAUDE.md:1127`). |
| Name panel | `#namePanel` (`:1694`), `openNamePanel()`, `saveName()` | Names the *visit*, not the place; separate from the property tag. |
| Proposal helper | `#proposalPanel` (`:1720`), `openProposal()`, `runProposal()`, `renderProposal()`, `addProposalItem()`, `proposalQty()` | Every line is a suggestion carrying the sentence it came from. `#proposalRun` Extract from transcript, `#proposalAddText` + `#proposalAdd` to add by hand (`CLAUDE.md:1216`). |
| Settings panel | `#settingsPanel` `.settings-panel` (`:1736`), `openSettings()`, `renderPrefs()` | `.pref-row` / `.pref-switch` rows: `#prefVertExag`, `#prefInspector` (Preview column), `#prefFilmstrip`, `#prefSplit`, `#prefFolds`, `#prefOutlineAimX`, `#prefOutlineEdges`, `#prefOutlineAimY`, `#prefGround`, `#prefEyeHeight`, plus the object-types reference `#objRef` built by `objRefBuild()`. |

### Screen: Review

`#reviewPanel` `.review-panel` (`index.html:1877`), `openReview()`, `reviewLoop()`

| Region | Term | Code identifier | What it is |
|---|---|---|---|
| Head | Review head | `.review-head`, `#reviewSwap` Show map, `#reviewDelete`, `#reviewClose` | |
| Left | Transcript rail | `#reviewTranscript` `.review-transcript`, `#rtStatus`, `#rtList`, `renderTranscriptList()`, `updateTranscriptHighlight()`, `pollTranscript()`, `speakerLabel()` | |
| Centre | Main stage | `.review-pane.in-main`, `setMainPane()` | Whichever of video/map is large. |
| Corner | Mini pane | `.review-pane.in-mini` | The other one, 190px — too small for the map toolbar or the pin inspector, both hidden there. |
| — | Video pane | `#reviewVideoPane`, `#reviewVideo`, `#reviewNoClip`, `updateReviewFrame()` | "No video at this point — audio continues". |
| — | Map pane | `#reviewMapPane`, `#reviewNoMap`, `mountMapInReview()`, `unmountMapFromReview()`, `updateReviewMapForTime()` | The one real map, re-parented in. |
| Bottom | Photo rail | `#reviewPhotoRail` `.review-photo-rail`, `renderReviewPhotoRail()`, `updateReviewPhotoHighlight()` | |
| Bottom | Transport bar | `.review-transport` — `#reviewPlayBtn`, `#reviewScrub` `.review-scrub`, `#reviewTime`, `syncReviewScrub()`, `updateReviewTime()` | |
| Bottom | Share clip | `#reviewShare` "Share clip with audio", `#reviewShareMsg`, `shareClipWithAudio()`, `updateShareButton()`, `getFFmpeg()` | Per-clip share: the silent clip remuxed with its slice of audio (`CLAUDE.md:1492`). |

### Object types

`OBJ_TYPES` (`index.html:8624`), `OBJ_ORDER` (`:8657`), `OBJ_ROLE` (`:8671`), `CLAUDE.md:2456`

| Type | Key | Shots | What it is |
|---|---|---|---|
| Spot elevation | `spot` | 1 | Origin only. The default. |
| Tree / Shrub | `tree`, `shrub` | 2 | Origin + apex, plus a typed **spread** diameter drawn as a ground-scale ring. |
| Fence / Wall | `fence`, `wall` | 2 + N | Origin, top of the first post, then the path. Level top along the whole run — a vertical face of plumb pairs. |
| House face | `face` | 3 | Origin, opposite end, roof line. A rectangle standing on the base line. |
| Box / structure | `box` | 4 | Origin + 2 more corners + top corner; three corners give the fourth. |
| Drain | `drain` | 1 | Origin plus a typed invert depth. |

Roles: `origin` (always mandatory, always a ground vertex), `height` (exactly one, plumb above the origin, never counted as ground), further ground points. `objNextRole()` is the single source of what the next shot is; `objGroundStep()` appends `· 1 of 2` when a prompt repeats.

---

## VoiceMap

Repo: the VoiceMap repo. Single-file `index.html` (12,484 lines), `CLAUDE.md`, `USER_MANUAL.md`.

### Domain vocabulary

| Term | Code identifier | What it is |
|---|---|---|
| Session | `session`, `SESSION_STORE = 'voicemap_session'` (`CLAUDE.md:81`) | The whole document: a tree of nodes plus metadata. |
| Card / node | `Node (Card)` schema (`CLAUDE.md:95`); `data-node-id` | One idea. "Card" on screen, `node` in code. |
| Nav stack | `navStack = [{id: null, label: 'Home'}, ...]`, `navigateInto()`, `navigateBack()`, `currentParentId()` | Drill-down position in the card list. |
| Status pip | `.pip`, `.pip-untouched` | The colour stripe on a card's left edge: gray untouched, amber in progress, green refined, indigo locked, solid green done. |
| Deferred / archived | `deferNode(id, days)`, `deferred_until`, `archiveNode()` | |
| Queue | `queueNode()`, `#calSidebarCards` | Cards waiting to be scheduled; shown in the Week sidebar. |
| Prompt log | `#promptLogModal`, `callClaude(userMessage, systemPrompt, prefill, label)` | Every AI call, with its label, kept for inspection. |

### Region: Chrome

| Term | Code identifier | What it is |
|---|---|---|
| Nav bar | `.nav-bar`, `#navTitle` `.nav-title`, `#backBtn` `.back-btn` | Where you are; ‹ Back appears once drilled in. |
| Tab bar / view switcher | `.view-switcher-bar` — `#tabCards`, `#tabMap`, `#tabBoard`, `#tabCal`, `#tabTable` `.view-tab` | Cards · Map · Board · Week (+ Table). |
| Menu | `#menuBtn` `.menu-btn`, `#menuDropdown` `.menu-dropdown`, `.menu-item` — `#miApiKey`, `#miCloudSync`, `#miPromptLog`, `#miPrompts`, `#miExport`, `#miImport`, `#miExportPrompt`, `#miRename`, `#miSelect`, `#miCluster`, `#miArchive`, `#miClear`, `#miIcal`, `#miOutlook`, `#miForceRefresh`, `#miVoiceMode` | |
| Record bar | `.record-bar`, `#recordBtn` `.record-btn`, `#liveText` `.live-text`, `#statusText` `.status-text`, `initRecognition()` | Voice capture; live transcription under the button. |
| Keyboard row | `#keyboardToggleBtn` `.keyboard-toggle-btn` ("Aa Type instead"), `#keyboardRow`, `#keyboardInput`, `#keyboardSendBtn` | Enter = add card; Cmd+Enter = add with AI. |
| Camera / sticky-note capture | `#cameraBtn` `.camera-btn`, `#imageInput`, `#ocrBtn`, `#ocrInput` | Photographs a whiteboard; Vision detects each sticky note and makes a card per note. |
| Tap-record overlay | `#tapRecordOverlay` `.tap-record-overlay`, `.tap-record-pulse`, `.tap-record-label` | Back Tap / `?record=1` launch path. |
| Toast | `#toast` `.toast` | |
| Undo / redo / search | `#undoBtn`, `#redoBtn`, `#searchBtn` `.search-btn` | |

### View 1: Cards (list)

`renderCards(animDir)`, `currentView = 'all' | 'pinned' | 'deferred' | 'orphaned'`

| Term | Code identifier | What it is |
|---|---|---|
| Card list | `#cardList`, `#cardScroll` `.card-scroll` | |
| Filter pills | `#cardFilterBar` `.view-filter-bar`, `.filter-pill` | **All** · 📌 **Pinned** · ⏳ **Deferred** · ◎ **Orphaned**. |
| Card | `.card-front`, `.card-body`, `.card-summary`, `.card-meta` | |
| Card badges | `.card-pin-badge`, `.card-defer-badge`, `.card-draw-badge`, `.card-gallery-badge` | |
| Drag handle | `.drag-handle` (⠿), `initDragHandlers()`, `dragState` | Drop zones: before (top 30%), inside (middle 40%), after (bottom 30%). |
| Swipe actions | `.card-swipe-wrap`, `.swipe-left-btns` / `.swipe-right-btns`, `.swipe-btn-done` / `-pin` / `-defer` / `-delete`; `initSwipeHandlers()`, `swipeState`, `openSwipeNodeId` | Right reveals ✓ Done and 📌 Pin; left reveals ⏳ Defer and 🗑 Delete. |
| Card action row | `.card-action-row`, `#cvPanel` `.cv-panel` — `#cvRefileBtn`, `#cvSimplifyBtn`, `#cvElaborateBtn`, `#cvExploreBtn`, `#cvGalleryBtn`, `#cvPinBtn`, `#cvDeleteBtn`, `#cvOpenBtn` | Appears when a card is expanded via ⓘ. |
| Empty state | `#emptyState` `.empty-state`, `.empty-hint` | |
| Merge bar | `#mergeBar` `.merge-bar`, `#mergeCount`, `#mergeDoBtn`, `#mergeCancelBtn` | Multi-select merge. |

### View 2: Mind Map

`#mmView` `.mm-view`, `renderMindMap()`, `CLAUDE.md:178`

| Term | Code identifier | What it is |
|---|---|---|
| Map canvas | `#mmCanvas` `.mm-canvas`, `#mmCanvasWrap`, `#mmSvg` `.mm-svg`, `#mmNodes`, `mmTransform = {x,y,scale}`, `applyMmTransform()` | |
| Map header | `.mm-header`, `#mmHeaderTitle`, `#mmFitBtn` (`mmZoomToFit()`), `#mmKbBtn`, `#mmRecordBtn` `.mm-header-record` | |
| Focus bar | `#mmFocusBar` `.mm-focus-bar`, `#mmFocusLabel`, `#mmExitFocusBtn`; `mmFocusNodeId`, `mmFocusOnNode()`, `mmExitFocus()` | Double-tap a node to enter Focus Mode. |
| Move bar | `#mmMoveBar` `.mm-move-bar`, `#mmMoveCancel`; `mmMoveMode`, `startMmMove()` / `executeMmMove()` / `cancelMmMove()`, `mmMoveArrowNav()` | Cmd+M. Cycle-guarded by `_mmIsDescendantOrSelf()`. |
| Map filter bar | `#mmFilterBar` `.mm-filter-bar`, `.mm-filter-pill` — `#mmFilterDeferred`, `#mmFilterArchived`, `#mmFilterLeafWide` | |
| Recording bar (map) | `#mmRecordingBar` `.mm-recording-bar`, `.mm-rec-dot`, `#mmLiveText`, `#mmStopBtn2` | |
| Node panel | `#mmPanel` `.mm-panel` — `#mmPanelTitle`, `#mmPanelSummary`, `#mmPanelMeta`, `#mmPanelPin`, `#mmPanelExpand`, `#mmPanelClose`, `.mm-panel-btn` (`#mmRefileBtn`, `#mmSimplifyBtn`, `#mmElaborateBtn`, `#mmExploreBtn`, `#mmExportPromptBtn`, `#mmAddParentBtn`, `#mmDeleteBtn`) | The detail panel for `mmSelectedId`. |
| Root grid / root tiles | `#mmRootGrid`, `.mm-root-tile`, `.mm-root-add-tile`, `#mmRootAddBtn`, `.mm-tile-badge`, `.mm-tile-label` | |
| Collapse toggle | `.mm-collapse-btn`, `mmCollapsed` (Set) | |

### View 3: Kanban Board

| Term | Code identifier | What it is |
|---|---|---|
| Board | `#kbView` `.kb-view`, `#kbBoard` `.kb-board` | Columns = children of the current node; cards = their children. Drag to reparent. |
| Column | `.kb-col-header`, `.kb-col-title`, `.kb-col-count`, `.kb-col-collapse-btn`, `.kb-cards` | |
| Board card | `.kb-card`, `.kb-card-title`, `.kb-card-meta` | |
| Detail panel | `#kbDetailPanel` `.kb-detail-panel`, `#kbDetailScrim`, `#kbDetailTitle`, `#kbDetailSummary`, `#kbDetailMeta`, `#kbDetailOpenBtn`, `#kbDetailClose`, `#kbAttachments` | |

### View 4: Week Calendar

| Term | Code identifier | What it is |
|---|---|---|
| Week view | `#calView` `.cal-view`, `#calBody` `.cal-body`, `#calGrid` `.cal-grid`, `scheduled_date` | 7-day grid. |
| Week header | `#calWeekLabel` `.cal-week-label`, `#calPrevBtn` / `#calNextBtn` `.cal-nav-btn`, `#calTodayBtn` `.cal-today-btn`, `#calWeekdaysBtn` | |
| Month strip | `#calMonthStrip` `.cal-month-strip` | |
| Queue sidebar | `#calSidebar` `.cal-sidebar`, `#calSidebarCards`, `#calSidebarToggle` `.cal-sidebar-toggle`, `.cal-sidebar-hdr` | The queue, beside the grid. |
| Day cell | `.cal-day-name`, `.cal-day-num`, `.cal-day-add` | |
| Time-block modal | `#tbModal`, `#tbGridWrap`, `#tbStartTime`, `#tbEndTime`, `#tbDaysRow`, `#tbAvgMin`, `#tbBadgeToggle`, `#tbSaveBtn` | |
| Year view | `#yrView`, `#yrWrap` `.yr-wrap` | |

### Modals and sheets

| Term | Code identifier | What it is |
|---|---|---|
| Context menu | `#nodeCtxMenu` `.node-ctx-menu`, `#nodeCtxOverlay`, `.node-ctx-item`, `showNodeCtxMenu(nodeId,x,y)`, `initNodeCtxMenu()` | 12 items: `#ctxPin`, `#ctxArchive`, `#ctxDefer`, `#ctxSchedule`, `#ctxQueue`, `#ctxEdit`, `#ctxConsolidate`, `#ctxTaskList`, `#ctxElaborate`, `#ctxExplore`, `#ctxRefile`, `#ctxDelete` (also `#ctxDraw`, `#ctxGallery`, `#ctxAddParent`, `#ctxDefineLog`, `#ctxTimeBlock`, `#ctxTaskMinutes`). |
| Edit-field modal | `#editFieldModal` `.defer-overlay` — `#editFieldLabel`, `#editFieldInput`, `#editFieldDesc`, `#editFieldSave`, `#editFieldCancel`; `pendingEdit`, `pendingMmAdd` | Title/summary edits, map child-node adds, and elaborate mode. |
| Consolidate modal | `#consolidateModal`, `#consolidatePreview`, `#consolidateAppend`, `#consolidateReplace`, `#consolidateCancel`; `_consolidatePending`, `_consolidateBuildMd()` | Shared by Consolidate to Markdown and Convert to Task List. The preview is editable before apply. |
| Quick Find | `#quickFindModal` `.qf-overlay`, `#quickFindInput` `.qf-input`, `#quickFindResults`, `.qf-item-label` / `.qf-item-path` / `.qf-item-summary`; `showQuickFind()`, `_qfRender()`, `_qfActivate()`, `_qfPath()` | Cmd+K from any view. |
| Defer modal | `#deferModal` `.defer-sheet`, `#deferCancel`, `.defer-option` | 1 day / 1 week / 1 month. |
| Schedule modal | `#scheduleModal`, `#scheduleDateInput`, `#scheduleTimeInput`, `#scheduleConfirmBtn`, `#scheduleRemoveBtn`, `#scheduleCancel` | |
| Recurrence modal | `#recurrenceModal`, `#weeklyPicker`, `#weeklyFromNow`, `#recurrenceCancel` | |
| Complete modal | `#completeModal`, `#completeModalTitle`, `#completeCancel` | |
| Chat / Explore modal | `#chatModal` `.chat-overlay` `.chat-sheet` — `#chatTitle`, `#chatMessages`, `#chatInput`, `#chatSendBtn`, `#chatVoiceBtn`, `#chatBadge` `.chat-context-badge`, `#chatClose`; `openChatModal(id)` | |
| Voice mode modal | `#voiceModeModal` `.vm-overlay` — `#vmOrb` `.vm-orb`, `#vmTranscript`, `#vmStatus`, `#vmMuteBtn`, `#vmCloseBtn`, `#vmKeyModal` | |
| API key modal | `#keyModal`, `#keyInput`, `#keySave`, `#keyTest`, `#keyTestResult`; `API_KEY_STORE = 'voicemap_api_key'` | |
| Sync modal | `#syncModal`, `#syncUrlInput`, `#syncTokenInput`, `#syncSave`, `#syncTest`, `#syncTestResult`, `#syncStatus` | Cloud sync (Supabase via VoiceData) / GitHub Gist. |
| Prompt log | `#promptLogModal` `.plog-overlay` `.plog-sheet` — `#plogList`, `#plogCount`, `#plogClear`, `#plogClose`, `.plog-entry`, `.plog-op-label`, `.plog-copy-btn` | |
| Prompts editor | `#promptsModal`, `#promptsEditorList` | |
| Log modal | `#logModal`, `#logFieldsList`, `#logAddFieldBtn`, `#logGrandchildrenToggle`, `#logSaveBtn` | Define-log fields on a card. |
| iCal / Outlook modals | `#icalModal` (`#icalTabUrl` / `#icalTabPaste`, `#icalUrlInput`, `#icalPasteInput`, `#icalSaveBtn`), `#outlookModal` (`#olClientIdInput`, `#olTenantIdInput`, `#olConnectBtn`, `#olDisconnectBtn`) | |
| Gallery overlay | `#galleryOverlay` `.gallery-overlay`, `#galleryGrid`, `#galleryAddBtn`, `.gallery-thumb` | |
| Lightbox | `#lightboxOverlay` `.lightbox-overlay`, `#lightboxImg`, `#lightboxCounter`, `#lightboxPrev` / `#lightboxNext`, `#lightboxAnnotateBtn`, `#lightboxShareBtn`, `#lightboxDeleteBtn` | |
| Annotate overlay | `#photoAnnotateOverlay` `.annotate-body`, `#annotateCanvas`, `#annotatePenBtn`, `#annotateCurvePenBtn`, `#annotateEraserBtn`, `#annotateTextBtn`, `#annotateStickerBtn`, `#annotateUndoBtn`, `#annotateSaveBtn` | |
| Draw modal | `#drawModal` `.draw-overlay`, `#drawCanvas`, `.draw-toolbar`, `#drawPenBtn`, `#drawEraserBtn`, `#drawClearBtn`, `#drawUndoBtn`, `#drawSaveBtn` | |
| External drop overlay | `#extDropOverlay`, `.drop-icon`, `.drop-label`, `.drop-sub` | |

---

## Elevation — "Perspective Elevation Ruler"

Repo: the Elevation repo. `index.html` (648), `styles.css` (984), `src/ui/*.js`, `README.md` (580).

### Domain vocabulary

| Term | Code identifier | What it is |
|---|---|---|
| Measurement plane / line of sight | `.plane-note`, `#plane-mode`, `PerspectiveProjection.js` | Every elevation is valid along one vertical plane only — the plane containing the camera and the sight line. Stated on screen and on every export. |
| MEASURED / PROJECTED | `#readout-tag` `.readout-tag` | An elevation you typed in, versus one interpolated from the calibration. |
| Calibration | `PerspectiveCalibration.js`; `#derived-cal`, `#derived-building` | Two routes: **from a building** (foundation + wall height + horizon) or **from two ground points** (origin + point B). |
| Ruler / rungs | `ElevationRuler.js`, `PALETTE.rung` (`OverlayRenderer.js`) | Three styles: **Follow the grade**, **Foundation**, **Levelling staff**. |
| Scale | `#scale-vertical`, `#scale-projected`, `#in-vertical-preset`, `#in-projected-preset` | Each half of a foundation ruler gets its own: siding courses, block courses, step risers, or a typed inch value. |
| Annotation / measurement point | `AnnotationManager.js`, `MeasurementAnnotation.js`, `#point-list` `.point-list` | A tapped reading, snapped onto the sight line. |
| Site survey | `SiteSurvey.js`, `#survey` | Five standard points shot from one position; map for distance, tilt for angle. |
| Curb assumption | `README.md:86`; `#survey-warn`, "The curb assumption" card (`index.html:571`) | Declaring the curb level with where you stand is what solves for instrument height outright. |
| Survey check | `#out-check` | The gap between the surveyed camera height and the one the photo geometry derives — a test of whether the photo was taken from the observation point. |
| Shot / dwell / spread | `TiltSensor.js`; `#sight-dwell`, `#sight-shots` | A shot averages tilt readings over a dwell and reports their spread. Repeatability is not accuracy. |

### Screen: Photo ruler view (the stage)

`<main class="stage" id="stage">` (`index.html:29`), `src/ui/PhotoView.js`, `src/ui/OverlayRenderer.js`

| Region | Term | Code identifier | What it is |
|---|---|---|---|
| — | Photo canvas | `#photo-canvas`, `PhotoView` | The working canvas. Never modifies the photograph; redraws it and composites the overlay each frame. |
| Centre | Empty state | `#empty-state` `.empty`, `#empty-take` Take Photograph, `#empty-choose` Choose Photograph, `.empty-rule` | |
| Top | Step HUD | `#hud` `.hud-top`, `#hud-step`, `#hud-text`, `#hud-next` `.hud-skip` | Step guidance floating over the picture. |
| Right | Readout | `#readout` `.hud-readout` — `#readout-elev` Elevation, `#readout-change` Change, `#readout-dist` Distance, `#readout-count` (Steps/courses), `#readout-tag` MEASURED/PROJECTED | Live readout for the selected or last-placed point. |
| Bottom | Plane note | `#plane-note` `.plane-note`, `#plane-mode` (e.g. `GRADE RULER`) | "Valid along the **line of sight** only — not across the photograph." |
| Corner | Zoom cluster | `#zoom-cluster` `.zoom-cluster` — `#zoom-in`, `#zoom-out`, `#zoom-fit` | |
| Corner | Controls toggle | `#drawer-toggle` `.drawer-toggle` | Shows the control panel on narrow screens. |

### Region: Control panel (right)

`<aside class="panel" id="panel">` (`index.html:95`), driven by `src/ui/App.js`

| Card | Term | Code identifier | What it is |
|---|---|---|---|
| 1 | Photograph | `data-step="1"`, `#btn-take`, `#btn-choose`, `#file-camera`, `#file-library`, `#photo-info` | |
| 2 | Known Points | `data-step="2"`, `#seg-method` (`#method-building` / `#method-twopoint`) | Calibration reference marks. |
| 2 | Foundation ref | `#ref-foundation` `.ref`, `.ref-name` "1 · Foundation", `#btn-set-foundation` | The zero line. |
| 2 | Wall height ref | `#ref-wall`, "2 · Wall height", `#btn-set-wall`, `#in-wall-height`, `#out-wall`, `#out-wall-dist` | |
| 2 | Horizon ref | `#ref-horizon`, "3 · Horizon", `#btn-reset-horizon` | Dragged onto the horizon you can see. |
| 2 | Origin / Point B refs | `#ref-origin` "Origin", `#ref-known` "Point B", `#btn-set-origin`, `#btn-set-known`, `#in-origin-elev`, `#in-known-elev`, `#seg-known-side`, `#dot-origin` / `#dot-known` | The two-ground-point method. |
| 3 | Calibrate Perspective | `data-step="4"`, `#btn-calibrate`, `#in-fov`, `#in-solve`, `#in-solve-mode`, `#hint-solve`, `#out-focal`, `#out-eye`, `#out-cam-h`, `#out-found`, `#out-eave`, `#out-peak`, `#out-pitch`, `#out-grade` | |
| 4 | Elevation Ruler | `data-step="5"`; `#seg-style` (grade / foundation / staff), `#in-range`, `#in-rung-width`, `#in-staff-distance` | **Above zero · vertical** and **Below zero · projected** sub-sections, each with `#in-vertical-preset` / `#in-projected-preset`, `-size`, `-unit`, `-noun`. |
| 5 | Display | `#in-label-mode`, `#in-units`, `#in-opacity`, `#tg-ruler`, `#tg-labels`, `#tg-horizon`, `#tg-crosshair`, `#tg-distances`, `#tg-sight` | Layer toggles for what the overlay draws. |
| 6 | Measurements | `#point-list` `.point-list`, `#btn-add-point`, `#btn-clear-points`, `#btn-dim-vertical` / `#btn-dim-horizontal` / `#btn-dim-grade`, `#dim-hint` | Tapped readings and the dimension tools. |
| — | Accuracy | `.card-quiet` (`index.html:421`) | The caveat card. |
| — | Export | `#btn-export`, `ExportManager.js` | |

### Screen: Site survey

`<div class="survey" id="survey">` (`index.html:451`), `src/ui/SiteMapView.js`, `src/core/SiteSurvey.js`

| Region | Term | Code identifier | What it is |
|---|---|---|---|
| Left | Map view **(preferred)** / survey plan | `#plan-map`, `.survey-plan`, `SiteMapView` | Satellite map centred on where you are standing. Leaflet is vendored, not CDN. |
| Left | Survey HUD | `#survey-hud` `.survey-hud` | "Finding you… then place the observation point where you stand." |
| Left | GPS badge | `#out-gps` `.map-badge`, `#out-gps-panel` | |
| Left | Survey zoom cluster | `.survey-zoom` — `#plan-in`, `#plan-out`, `#plan-locate` ◎, `#plan-fit` ⤢ | |
| Right | Survey panel | `.survey-panel`, `#survey-close` | Four numbered cards. |
| 1 | Map card | `#btn-locate`, `#seg-basemap`, `#survey-points` `.survey-points` | The five standard points (three pins: observation, curb, wall). |
| 2 | Overlay image card | `#btn-aerial`, `#file-aerial`, `#overlay-controls`, `#in-ov-width`, `#in-ov-rot`, `#in-ov-op`, `#btn-plan-clear` | Optional. |
| 3 | Shots card | `#btn-shoot-grades`, `#seg-shootmode`, `#btn-tilt`, `#tilt-readout` `.tilt-readout`, `#tilt-hint`, `#in-inst-mode`, `#in-inst-height`, `#in-distance` | |
| 4 | Result card | `#survey-result`, `#out-survey-grade`, `#out-b-cam`, `#out-b-dist`, `#out-b-eye`, `#out-b-grade`, `#out-check` Survey check, `#btn-apply-survey` "Use for photo calibration", `#survey-warn` | Hands camera height, wall height, distance and grade to the photo calibration, measured rather than typed. |
| — | Curb assumption card | `.card-quiet` (`index.html:571`) | |

### Screen: Sight view (shooting the grades)

`<div class="sight" id="sight">` (`index.html:597`), `src/ui/SightView.js`

| Term | Code identifier | What it is |
|---|---|---|
| Sight view **(preferred)** / sight HUD | `#sight`, `.sight-overlay`, `SightView` | Hold the iPad up and it walks down the list of points asking for each in turn. The camera is not measuring — the angle comes off the tilt sensor. |
| Camera preview | `#sight-video` | |
| Target label | `#sight-target` `.sight-target` | Which point is being asked for. |
| Shot counter / hint | `#sight-count` ("0 of 4 shot"), `#sight-shots` ("hold steady to shoot") | |
| Crosshair / dwell ring | `#sight-dwell` `.sight-cross`, `.sight-ring`, `.sight-h`, `.sight-v` | |
| Angle readout | `#sight-angle` `.sight-angle` | |
| Point chips | `#sight-chips` `.sight-chips` | |
| Actions | `#sight-done` Done, `#sight-skip` Skip →, `#sight-shoot` Shoot now | |
| Saved frame | `SightView.js` header comment | Every shot keeps its frame with the crosshair burned in at the point's own colour — the foundation's frame becomes the photograph. |

### Sheet: Export / share

| Term | Code identifier | What it is |
|---|---|---|
| Export sheet | `#export-sheet` `.sheet`, `ExportManager.js` | Composites photograph + overlay at the photograph's own resolution, with a caption strip carrying the calibration and the accuracy caveat. |
| Export image | `#export-image` `.sheet-body`, `#export-title`, `#export-hint` | "Press and hold the image to save it to Photos." |
| Download / Open in new tab / Done | `#export-download`, `#export-open`, `#export-close` | |
| Toast | `#toast` `.toast` | |

---

## PerspectivePhoto

Repo: the PerspectivePhoto repo (`src/`, `ARCHITECTURE.md`). The help panel lives only in the VoiceData copy: `VoiceData/src/components/design/components/HelpPanel.tsx`.

### Domain vocabulary

| Term | Code identifier | What it is |
|---|---|---|
| Project | `Project` — `src/types/index.ts:77`; `useProjectStore` | The design: background photo, perspective config, placed stamps, plan config, lighting. |
| View mode | `ViewMode = 'photo' \| 'plan' \| 'lighting'` (`types/index.ts:94`), `setViewMode()` | Photo · Plan · Lighting. Keys 1/2/3. |
| Tool mode | `ToolMode = 'select' \| 'horizon' \| 'calibrate' \| 'eraser' \| 'objEraser' \| 'pan' \| 'placeLight' \| 'lightPen'` (`types/index.ts:12`), `setToolMode()` | |
| Stamp / placed stamp | `PlacedStamp` (`types/index.ts:65`), `StampAsset` (`:29`), `CustomStamp` (`:40`) | A plant image placed in the photo view, scaled by depth. |
| Plan symbol | `usePlanSymbolStore` (IndexedDB `plan-symbols`) | The 2D top-down equivalent — a separate object database from perspective stamps. |
| Perspective config | `PerspectiveConfig` (`:21`), `engine/perspective.ts` — `calculateScale()`, `createDefaultPerspective()` | Horizon line + calibration ref; drives depth scaling. |
| Calibration ref | `CalibrationRef` (`:14`), `engine/personSilhouette.ts` | The person silhouette: position, feet Y, and real height. |
| Homography / warp | `engine/homography.ts` (DLT solver), `PlanOverlay.tsx` | The 4-corner distort that maps a plan crop onto the photo. |
| Light source / preset | `LightSource` (`:100`), `LightingConfig` (`:115`), `LightPreset = 'uplight' \| 'path' \| 'spotlight'` (`:98`), `lightPresets.ts` | |
| Object category | `ARCHITECTURE.md:281` | Shade Trees, Ornamental Trees, Columnar, Grasses, Shrubs, Perennials, Ground Cover, Surfaces (textures — photo view only). |
| Species lock | `ARCHITECTURE.md:160` | Locks a symbol's size as its default so it drops at the right scale next time. |
| History | `HistoryEntry` (`:89`) | Undo/redo stack. |

### Region: Toolbar (top)

`src/components/Toolbar/Toolbar.tsx`

| Term | Code identifier | What it is |
|---|---|---|
| Toolbar | `Toolbar.tsx` | Upload · tools · view toggle · import/export · settings. |
| Upload Photo / Use Jobsite Photo | file input (`Toolbar.tsx:59,78`) | The background photo. In the deal-linked build, pick one already on the deal. |
| View toggle | `'photo'` / `'plan'` / `'lighting'` (`Toolbar.tsx:235–255`) | |
| Tool buttons | `'select'` Select · `'calibrate'` Calibrate · `'eraser'` Erase Overlay · `'objEraser'` Object Eraser · `'placeLight'` Place Light · `'lightPen'` Light Pen (`Toolbar.tsx:175–180`) | |
| Paste Overlay | `Toolbar.tsx` | Flattens the warped plan crop down onto the photo (reset stage to 1:1 before `toDataURL()`). |
| Export PNG | `'landscape-design.png'` (`Toolbar.tsx:160`) | Also saved as the design's preview on the deal. |
| Import / Export Library | `HelpPanel.tsx:61` | The plant library as JSON. |
| Help panel | `HelpPanel.tsx`, `title="Help & shortcuts"` | Sections: **Views**, **Getting started**, **Placing & editing plants**, **Plan view**, **Finishing**, plus a shortcut table. Present in the VoiceData copy only. |
| Settings menu | `SettingsMenu.tsx`, `title="Settings"` | Photo Saturation, Brightness, Contrast, Photo Opacity, and horizon adjust. Presets: Full Color / Faded / B&W, Flat / Bright / Dark, Full / High. Sections **App** and **Perspective**. |

### Region: ToolsSidebar (left)

`src/components/GestureControls/ToolsSidebar.tsx`

| Term | Code identifier | What it is |
|---|---|---|
| Tools sidebar **(preferred)** / left sidebar | `ToolsSidebar.tsx` | |
| Size slider | inlined in `ToolsSidebar.tsx` (legacy standalone: `SizeSlider.tsx`) | Vertical slider showing a percentage (e.g. 112%). |
| Stamp gun / duplicate toggle | `ToolsSidebar.tsx` ⧉ | Repeats the selected plant on each tap. |
| Move mode | `ToolsSidebar.tsx` | Reposition without the resize handles. |
| Delete | `title="Delete selected"` / `title="Delete light"` | |
| Undo / Redo | `title="Undo"` / `title="Redo"` | |
| Clear Pen | `>Clear Pen<`, `title="Clear pen strokes"` | Lighting pen strokes. |

### Region: ObjectStrip (right)

`src/components/StampLibrary/ObjectStrip.tsx`

| Term | Code identifier | What it is |
|---|---|---|
| Object strip **(preferred)** / right sidebar | `ObjectStrip.tsx` | Upload/paste, category label, thumbnails, joystick. |
| Upload / Paste | `title="Upload"` / `title="Paste"` | Users supply their own objects — there are no built-in plant assets. |
| Category toggle | `CategoryToggle.tsx`, `title="Next category"` (↻) | Circle button cycling the object categories. |
| Movement joystick | inlined in `ObjectStrip.tsx` (legacy standalone: `MovementJoystick.tsx`), Move (◎) | Nudges the selected object. |
| Surfaces tab / texture grid | `TextureGrid.tsx` — `Built-in` / `My Textures`, `engine/textureAssets.ts` | Procedural textures (mulch, gravel, brick). Photo view only. |

### View: Photo (perspective)

`src/components/Canvas/`

| Term | Code identifier | What it is |
|---|---|---|
| Editor canvas | `EditorCanvas.tsx` | The main Konva Stage. |
| Background image | `BackgroundImage.tsx` | Photo with saturation/brightness/contrast/opacity filters. Must `node.cache()` after changing a filter. |
| Plant stamp | `PlantStamp.tsx` | One perspective-scaled Konva Image. Placement is press-drag-release (`ARCHITECTURE.md:123`). |
| Horizon mode / perspective guides | `PerspectiveGuides.tsx`, `ToolMode = 'horizon'` | The horizon line and its drag handles; only visible in horizon mode. |
| Calibration overlay | `CalibrationOverlay.tsx`, `engine/personSilhouette.ts` | The person silhouette dropped where someone would stand and sized to real height. |
| Plan overlay | `PlanOverlay.tsx`, `engine/homography.ts` | The warped plan selection — Morpholio-style 4-corner distort (`ARCHITECTURE.md:138`). |
| Selected-item bar | `HelpPanel.tsx:42` | Size, Opacity, Rotate, Flip, Bring Forward / Send Back, Duplicate, Delete. |

### View: Plan

`src/components/PlanView/`

| Term | Code identifier | What it is |
|---|---|---|
| Plan view canvas | `PlanViewCanvas.tsx`, `PlanViewConfig` (`types/index.ts:130`) | Place 2D symbols and draw the polygon selection to warp. |
| Plan stamp | `PlanStamp.tsx` | One plan symbol; no perspective scaling. |
| Cluster outlines | `ClusterOverlay.tsx`, `clusterUtils.ts` | Grouped outlines around massed plantings. |
| Stubs / legacy | `PlanGrid.tsx`, `PlanStampCircle.tsx`, `PointMatcher.tsx`, `ScaleSetup.tsx` | All replaced by the corner-drag warp; kept as stubs. |

### View: Lighting

`src/components/Lighting/`

| Term | Code identifier | What it is |
|---|---|---|
| Lighting canvas | `LightingCanvas.tsx`, `LightingOverlay.tsx` | Darkens the scene. |
| Light marker | `LightMarker.tsx` | One placed light. |
| Light properties panel | `LightPropertiesPanel.tsx` | |
| Light presets | `lightPresets.ts` — uplight, path, spotlight | |

### Other

| Term | Code identifier | What it is |
|---|---|---|
| Plant table / Plant Database | `PlantTable.tsx` — columns Name, Botanical Name, Common Name, Category, Notes | The full library table for renaming and editing plant metadata (`PlantMeta`, `types/index.ts:57`). |
| Properties panel | `PropertiesPanel/PropertiesPanel.tsx` | **Legacy** — replaced by the gesture controls. Note it if someone says "properties panel"; they probably mean the selected-item bar. |
| Legacy sidebar components | `StampCard.tsx`, `StampLibrary.tsx`, `CustomStampUpload.tsx`, `SizeSlider.tsx`, `MovementJoystick.tsx` | All superseded; listed so an agent does not edit the dead copy. |
