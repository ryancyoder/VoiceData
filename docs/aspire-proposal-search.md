# Aspire proposal search

Opens a deal's Aspire proposal page straight from the Sales Board, without
anyone having to search Aspire by hand.

## Why it needs a headless browser

Aspire's proposal URLs aren't derivable from the proposal number — there is no
static pattern to jump to. The only route in is typing the number into Aspire's
search box and clicking the matching row, and that row is an Angular click
handler, not a link, so there's no `href` to scrape either. Aspire also requires
a logged-in session, which rules out doing any of this from the user's browser
against a third-party origin. So the click path runs server-side in headless
Chromium, and the URL it lands on is cached on the deal.

## The flow

1. **Button** — beside **Proposal #** in the deal modal
   (`src/app/sales-board/DealModal.tsx`).
   - `aspire_link` already set → the button reads **Open in Aspire ↗** and just
     opens it. No backend call, no browser.
   - `aspire_link` empty → **Find in Aspire** posts to `/api/aspire-search`,
     shows a loading state, and opens the URL that comes back.
   - **↻** (only shown once a link is stored) re-runs the search and replaces
     the saved link — for when the stored one is stale or wrong.
2. **Route** — `src/app/api/aspire-search/route.ts`. Resolves the proposal
   number from the request or the deal row, returns the cached `aspire_link`
   when there is one, otherwise runs the search, writes the resolved URL onto
   the Sales Board row, and returns it. Concurrent requests for the same
   proposal share one run rather than launching two browsers.
3. **Driver** — `src/lib/aspireBrowser.ts`. Loads the stored session, opens
   Aspire, fills `input[name="searchAspire"]`, waits out the live-filter
   debounce, picks the row whose title starts `#<proposal number>`, clicks it,
   waits for the navigation, and reads `page.url()`. The page is sized to
   1920x1080 first: headless Chromium's 1280x720 default is narrow enough that
   Aspire's nav collapses and hides the search box, and "signed in" is
   therefore tested by the search box existing in the DOM, not by it being on
   screen. If it's present but hidden, the driver clicks the collapsed search
   icon before giving up.
4. **Session** — `src/lib/aspireSession.ts`. Cookies encrypted with AES-256-GCM
   under `ASPIRE_SESSION_SECRET`, stored in the existing `app_settings` table.

## Setup

Set `ASPIRE_SESSION_SECRET` (`openssl rand -hex 32`) and give the app a
browser — see `.env.example` for the full list. Then visit
**`/admin/aspire-session`**, which shows what's configured, what's missing, and
the last failure, and lets you paste a signed-in Aspire session (either the raw
`Cookie:` header from your browser's network panel or a Playwright
storage-state JSON blob), test it, or clear it.

### Where the browser comes from

`playwright-core` is a dependency, but browsers are not — nothing downloads
Chromium at install time.

- **Production (serverless):** there is no browser on the box. Point
  `ASPIRE_BROWSER_WS_ENDPOINT` at a remote Chromium (Browserless, Browserbase,
  or your own `docker run browserless/chrome`). Those speak CDP, which is the
  default; set `ASPIRE_BROWSER_PROTOCOL=playwright` for a `playwright
  run-server` endpoint instead.
- **Local / self-hosted:** point `ASPIRE_BROWSER_EXECUTABLE` at an installed
  Chrome or Chromium binary, or run `npx playwright install chromium` and leave
  both unset — the launcher falls back to whatever `playwright-core` can find.

The route is `runtime = "nodejs"` with `maxDuration = 90`; a cold Aspire load
plus the debounced search plus the proposal page's own load can take a while.

### A note on window size

Browserless runs its Chrome at 800x600 and ignores attempts to change it —
`browser.newContext({ viewport })`, `page.setViewportSize`, and a direct CDP
`Emulation.setDeviceMetricsOverride` were all tried against the live service
and all left the page reporting 800x600 (the same code does work against a
CDP-connected Chromium you launch yourself, so this is the provider, not
Playwright). What Browserless honours is a window size passed as a launch
argument on the connection URL, so the driver appends
`--window-size=1920,1080` (both the v2 `launch` JSON parameter and the legacy
bare flag) to any browserless host automatically. That matters because at
800px Aspire's *nav* search box isn't merely hidden — it never renders.

`ASPIRE_SEARCH_URL` still exists for pointing the flow at a page-level search
box instead, but note the trade found in practice: the opportunities grid's
search respects whatever filters the grid has saved, so a filtered-out
proposal returns zero rows there while the nav search finds it. The nav
search is the default for a reason.

## Pointing at a different search page

The nav search box is the confirmed click path, but it lives in a nav that
collapses. `ASPIRE_SEARCH_URL` moves the whole flow to any page with a search
box — `/app/opportunities/search` has one that's always on screen — and the
four `ASPIRE_*_SELECTOR` variables adapt the driver to that page's markup.

Don't guess those selectors. Set `ASPIRE_SEARCH_URL` alone and run it once:
the failure reports how many rows the current row selector matched and, for
every element whose text contains the proposal number, its tag, classes, and
`href`. That's enough to read the right selectors off directly — and if the
rows turn out to be real links, the URL is available without clicking at all,
which would make this whole flow considerably simpler.

## Watching a run live

While a search is running, the button area shows a **👁 Watch live** link
(and `/admin/aspire-session` shows the same during its "Test session").
Opening it shows the robot's actual browser in real time — Browserless's
"live URL" feature, requested over CDP (`Browserless.liveURL`) at the start
of each run, parked in `app_settings` for the frontend to poll
(`/api/aspire-live`), and cleared when the run ends. On a non-Browserless
endpoint, or a plan without the feature, the request fails silently and the
run proceeds unwatched.

The live view is interactive, which turns the verification-code dead end into
a ten-second assist: when Aspire challenges the login with a code, the run
posts that ask next to the link and holds the door open for two minutes while
you open the live view and type the code from your phone. The session cookies
saved after a success remember the device, so this should be a once-per-device
event. (This is also why the search route's `maxDuration` is 300 seconds and
the frontend's timeout matches.)

## When it fails

Headless failures are invisible by default, so each one lands in three places:
the server log (`[aspire-search] <code>: <message>`), the response the button
renders inline under the field, and an `app_settings` row that
`/admin/aspire-session` displays as **Last failure**.

| Code | What happened |
| --- | --- |
| `browser_unavailable` | No remote endpoint and no launchable local browser. |
| `session_missing` | Not signed in, and no credentials to sign in with. |
| `login_failed` | The stored session expired and re-authentication didn't take. |
| `no_match` | Aspire's search returned nothing for that number. |
| `ambiguous` | More than one result matched — the button lists them to pick from. |
| `navigation_failed` | The result was clicked but the page never navigated. |

## Open questions

These came out of building it and are worth confirming against the live tenant:

- **Login flow.** Now observed, not guessed: `cloud.youraspire.com/login` is a
  single form with four fields — `emailAddress`, `password`, `companyCode`,
  and `deviceName` — and one "Log in" button. All four are filled;
  `ASPIRE_COMPANY_CODE` is required and the login is refused early with a
  clear message if the field is on screen and the variable is unset.
  Selectors stay overridable via `ASPIRE_LOGIN_*_SELECTOR` in case the form
  changes.
- **Device verification.** Aspire sometimes asks for a four-digit code, which
  a headless run cannot answer. `ASPIRE_DEVICE_NAME` is deliberately constant
  (default `VoiceData`) so Aspire sees the same device each time rather than a
  new one, and every successful run writes the ending cookies back, so a
  remembered device should keep being remembered. When a code *is* demanded,
  the run fails with the login page's shape in the message, and the way
  through is to paste a session at `/admin/aspire-session`.
- **Session lifetime.** Unknown. Every successful run writes the ending cookies
  back, so an actively used session should keep renewing itself; a long-idle
  one will need re-pasting.
- **Duplicate proposal numbers.** Handled rather than assumed away: exact
  `#number` matches win over rows that merely contain the number, and if more
  than one exact match survives, the search returns the candidate list instead
  of guessing and the user clicks the right one.
- **What `aspire_link` holds today.** The column is also what the existing
  "Parse from Aspire" button reads a proposal PDF from, so older rows may hold
  a PDF URL rather than the proposal page. The button opens whatever is stored;
  **↻** replaces it with the searched-for proposal page.
