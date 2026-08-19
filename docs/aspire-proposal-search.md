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
   waits for the navigation, and reads `page.url()`.
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

- **Login flow.** Aspire's login markup isn't documented here, and if the
  account uses SSO or MFA there is no unattended path through it at all. The
  credential path is written defensively (selectors are overridable via
  `ASPIRE_LOGIN_*_SELECTOR`, and a two-step username-then-password page is
  handled), but it is unverified. Pasting a session at `/admin/aspire-session`
  is the path that definitely works; treat auto-login as the convenience.
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
