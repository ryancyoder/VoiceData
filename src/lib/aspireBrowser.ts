import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import {
  ASPIRE_BASE_URL,
  loadAspireSession,
  saveAspireSession,
  type AspireCookie,
} from "@/lib/aspireSession";

// ─── Aspire headless search ──────────────────────────────────────────────
//
// Aspire proposal URLs aren't derivable from the proposal number — the only
// way to a proposal's page is to type the number into Aspire's search box and
// click the matching result. Aspire also requires a logged-in session, so this
// can't run in the user's browser against a third-party origin; it runs here,
// server-side, in a headless Chromium, and the URL it lands on is cached back
// onto the deal (Sales Board `aspire_link`) so the click path only ever has to
// run once per proposal.

// Confirmed against the live app (Safari Inspect): the search box is a
// PrimeNG input with a stable `name`, and results are `.search-result` rows
// whose title anchor has no id or href — an Angular click handler, not a link —
// so the only thing to match on is the visible text.
// The nav search box has a stable `name`; a page-level search box (AG Grid's
// quick filter on /app/opportunities/search, say) has no name or id at all, so
// the fallbacks match on the things such an input does carry. First match in
// DOM order wins, and ASPIRE_SEARCH_INPUT_SELECTOR overrides the lot.
const SEARCH_INPUT =
  process.env.ASPIRE_SEARCH_INPUT_SELECTOR?.trim() ||
  'input[name="searchAspire"], input[type="search"], input[placeholder*="search" i], ' +
    'input[aria-label*="search" i], input[class*="search" i]';
const RESULT_ROW = process.env.ASPIRE_RESULT_ROW_SELECTOR?.trim() || ".search-result";
const RESULT_TITLE = process.env.ASPIRE_RESULT_TITLE_SELECTOR?.trim() || "a.pointer:not(.result-sub-name)";
const RESULT_SUBTITLE = process.env.ASPIRE_RESULT_SUB_SELECTOR?.trim() || "a.result-sub-name";

// Where the driver goes to search. The default is the app root, whose nav
// search box is the confirmed click path — but that box collapses when the nav
// is tight, so ASPIRE_SEARCH_URL can point at a page with a search box that's
// always on screen (e.g. /app/opportunities/search) without a code change.
// A different page means different markup, hence the selector overrides above.
const SEARCH_URL = process.env.ASPIRE_SEARCH_URL?.trim() || ASPIRE_BASE_URL;

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const SIGNED_IN_TIMEOUT_MS = 20_000;
// Headless Chromium defaults to 1280x720, narrow enough that Aspire's nav
// collapses and folds the search box away behind an icon. A desktop-sized
// window keeps the search box on screen where the click path expects it.
const VIEWPORT = { width: 1920, height: 1080 };
const LOGIN_TIMEOUT_MS = 30_000;
const RESULT_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 25_000;
// Results filter live as you type and the filter is debounced, so the first
// row to appear isn't necessarily the last: wait out one more debounce window
// after a match shows up before reading the list.
const DEBOUNCE_SETTLE_MS = 600;

export type AspireErrorCode =
  | "browser_unavailable"
  | "session_missing"
  | "login_failed"
  | "search_unavailable"
  | "no_match"
  | "ambiguous"
  | "navigation_failed"
  | "unexpected";

export interface AspireCandidate {
  index: number;
  title: string;
  subtitle: string;
}

export type AspireSearchResult =
  | { ok: true; url: string; title: string }
  | { ok: false; code: AspireErrorCode; message: string; candidates?: AspireCandidate[] };

export interface AspireSearchOptions {
  proposalNumber: string;
  // Which result to click when the number matched more than one row. Comes
  // back from the caller after the ambiguous response listed the candidates.
  resultIndex?: number;
}

// Playwright appends a multi-line "Call log:" dump to connection errors —
// useful in a terminal, unreadable in the small red line under a form field.
// Keep the first sentence or two; the full text is still in the server log.
function briefError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const beforeCallLog = raw.split(/\n?Call log:/)[0];
  const collapsed = beforeCallLog.replace(/\s+/g, " ").trim();
  return collapsed.length > 300 ? `${collapsed.slice(0, 297)}…` : collapsed;
}

function squish(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

// Titles read `#20519 - 2026 Aeration, Overseeding…`. The leading number is
// the proposal number; everything after the dash is the proposal name.
function leadingNumber(title: string): string | null {
  const match = title.match(/^#\s*([0-9]+)/);
  return match ? match[1] : null;
}

// ─── Browser acquisition ─────────────────────────────────────────────────

// A 401 from the remote browser is almost always the endpoint value itself —
// a key that got clipped when it was copied, a line break pasted into the
// middle of it, or the token left off the URL entirely. None of that is
// visible from the outside, and the token must never be logged, so this
// describes the SHAPE of the configured URL without any of its secrets.
function describeEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "the configured endpoint isn't a valid URL";
  }
  const token = url.searchParams.get("token");
  const parts = [`host=${url.host}`, `path=${url.pathname}`, `protocol=${url.protocol}`];
  parts.push(token === null ? "token=MISSING" : `token=${token.length} chars`);
  if (token && /\s/.test(token)) parts.push("token contains whitespace");
  if (/\s/.test(raw)) parts.push("URL contains whitespace");
  return parts.join(", ");
}


interface AcquiredBrowser {
  browser: Browser;
}

// playwright-core is imported statically rather than with a dynamic import().
// Next treats it as an external package, so it's `require`d at runtime rather
// than bundled, and the deploy-time file tracer decides what to copy into the
// serverless function by walking imports. Behind a dynamic import it traced
// only part of the package (the entry point and some of lib/), so the require
// succeeded and then threw on a missing internal file. See the forced
// outputFileTracingIncludes in next.config.ts, which guarantees the rest.
// Browserless runs its Chrome at 800x600 and, tested against the live
// service, ignores every post-connection way of changing that — newContext
// viewport, setViewportSize, and a direct CDP Emulation override all left the
// page at 800x600. What it does honour is a window size passed as a launch
// argument on the connection URL, so append one there. Both the v2 `launch`
// JSON parameter and the legacy bare flag are set; each version ignores the
// other's. Only touches browserless hosts — an arbitrary CDP endpoint gets
// its URL passed through untouched.
function withWindowSize(endpoint: string | undefined): string | undefined {
  if (!endpoint) return endpoint;
  try {
    const url = new URL(endpoint);
    if (!/browserless/i.test(url.hostname)) return endpoint;
    const size = `--window-size=${VIEWPORT.width},${VIEWPORT.height}`;
    if (!url.searchParams.has("launch")) {
      url.searchParams.set("launch", JSON.stringify({ args: [size] }));
    }
    if (!url.searchParams.has(size.split("=")[0])) {
      url.searchParams.set("--window-size", `${VIEWPORT.width},${VIEWPORT.height}`);
    }
    return url.toString();
  } catch {
    return endpoint;
  }
}

async function acquireBrowser(): Promise<AcquiredBrowser | { error: string }> {
  const endpoint = withWindowSize(process.env.ASPIRE_BROWSER_WS_ENDPOINT?.trim());
  if (endpoint) {
    // Browserless/Browserbase-style remote Chromium speaks CDP; a
    // `playwright run-server` endpoint speaks Playwright's own protocol.
    const protocol = (process.env.ASPIRE_BROWSER_PROTOCOL || "cdp").trim().toLowerCase();
    try {
      const browser =
        protocol === "playwright"
          ? await chromium.connect(endpoint, { timeout: PAGE_LOAD_TIMEOUT_MS })
          : await chromium.connectOverCDP(endpoint, { timeout: PAGE_LOAD_TIMEOUT_MS });
      return { browser };
    } catch (err) {
      return {
        error: `Couldn't connect to the remote browser: ${briefError(err)} [${describeEndpoint(endpoint)}]`,
      };
    }
  }

  // No remote endpoint: launch locally. Serverless platforms have no browser
  // on disk, so this path is really for local dev and self-hosted runs, where
  // an installed Chrome/Chromium can be pointed at with ASPIRE_BROWSER_EXECUTABLE.
  const executablePath = process.env.ASPIRE_BROWSER_EXECUTABLE?.trim() || undefined;
  try {
    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return { browser };
  } catch (err) {
    return {
      error:
        `Couldn't start a headless browser (${briefError(err)}). Set ASPIRE_BROWSER_WS_ENDPOINT ` +
        `to a remote Chromium, or ASPIRE_BROWSER_EXECUTABLE to a local Chrome binary.`,
    };
  }
}

// Getting a usable window size out of a remote browser is the fiddly part.
// A context created with an explicit viewport is the well-supported path, so
// try that first; a provider that won't allow a fresh context falls back to
// the default one, where the size has to be forced onto each page instead.
async function openContext(browser: Browser): Promise<{ context: BrowserContext; ownsContext: boolean }> {
  try {
    return { context: await browser.newContext({ viewport: VIEWPORT }), ownsContext: true };
  } catch {
    const existing = browser.contexts()[0];
    if (existing) return { context: existing, ownsContext: false };
    return { context: await browser.newContext(), ownsContext: true };
  }
}

// Belt and braces on top of that: Browserless runs its Chrome at 800x600 and
// ignored setViewportSize, and Aspire doesn't merely hide its search box at
// that width — it never renders it. So set the size, read back what the page
// actually got, and if it didn't take, drive it through CDP directly.
// Returns the size in force, which callers put in their diagnostics: guessing
// at the viewport is what made this take three rounds to spot.
async function forceViewport(context: BrowserContext, page: Page): Promise<string> {
  await page.setViewportSize(VIEWPORT).catch(() => {});
  const measure = () => page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`).catch(() => "unknown");

  if ((await measure()) === `${VIEWPORT.width}x${VIEWPORT.height}`) return `${VIEWPORT.width}x${VIEWPORT.height}`;

  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  } catch {
    // Nothing more to try — the measured size below tells the caller.
  }
  return measure();
}

// ─── Session ─────────────────────────────────────────────────────────────

function cookieDomain(): string {
  return new URL(ASPIRE_BASE_URL).hostname;
}

async function applyStoredSession(context: BrowserContext): Promise<boolean> {
  const session = await loadAspireSession();
  if (!session) return false;
  const domain = cookieDomain();
  const cookies = session.cookies.map((c) => ({
    ...c,
    domain: c.domain || domain,
    path: c.path || "/",
  }));
  try {
    await context.addCookies(cookies);
    return true;
  } catch {
    // A malformed stored cookie shouldn't sink the run — fall through to the
    // login path instead.
    return false;
  }
}

// Persist whatever cookies the run ended with, so a session that Aspire
// refreshed mid-run (rotated token, extended expiry) survives to the next one.
async function persistSession(context: BrowserContext): Promise<void> {
  try {
    const cookies = (await context.cookies()) as AspireCookie[];
    const relevant = cookies.filter((c) => (c.domain || "").includes(cookieDomain().replace(/^www\./, "")));
    if (relevant.length > 0) await saveAspireSession(relevant);
  } catch {
    // Best effort: a failed refresh just means the next run re-authenticates.
  }
}

// Being signed out is what's actually detectable: Aspire redirects to /login.
// Everything else — the search box's visibility, or even its presence, which
// varies by which page ASPIRE_SEARCH_URL points at — is a question about that
// page's markup, not about the session. Judging the session by the search box
// is what sent a working login back around the login flow.
//
// Waits for either signal to settle so a slow app boot isn't read as signed
// out, then decides on the URL alone. Correct only BEFORE a login attempt,
// where sitting on /login is a final answer — after submitting credentials it
// is not, so use waitForLoginToLand for that.
async function isSignedIn(page: Page, timeout: number): Promise<boolean> {
  await page
    .waitForFunction(
      (selector: string) =>
        document.querySelector(selector) !== null || /\/login/i.test(window.location.pathname),
      SEARCH_INPUT,
      { timeout }
    )
    .catch(() => {});
  return !/\/login/i.test(new URL(page.url()).pathname);
}

// After submitting credentials, /login is where the page sits while the login
// is still in flight — the button reads "Logging in…" — so it means "not
// finished yet", not "signed out". This waits for the page to actually leave
// the login route. Reusing the pre-login check here made the run give up the
// instant it submitted, mid-request, and call a login in progress a failure.
async function waitForLoginToLand(page: Page, timeout: number): Promise<boolean> {
  await page
    .waitForFunction(
      (selector: string) =>
        !/\/login/i.test(window.location.pathname) || document.querySelector(selector) !== null,
      SEARCH_INPUT,
      { timeout }
    )
    .catch(() => {});
  return !/\/login/i.test(new URL(page.url()).pathname);
}

// What the login page actually contains, for when the selectors miss. Aspire's
// login markup isn't documented anywhere we control and this runs headless, so
// without this a failure is just "click timed out" and the next attempt is
// another guess. Field names and button labels only — never a typed value.
async function describeLoginPage(page: Page): Promise<string> {
  try {
    const shape = await page.evaluate(() => {
      const visible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const inputs = Array.from(document.querySelectorAll("input"))
        .filter(visible)
        .map((el) => `input[type=${el.type || "text"}${el.name ? ` name=${el.name}` : ""}${el.id ? ` id=${el.id}` : ""}]`);
      const buttons = Array.from(document.querySelectorAll("button, input[type=submit], a[role=button]"))
        .filter(visible)
        .map((el) => {
          const label = (el.textContent || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
          return label ? `"${label.slice(0, 40)}"` : `<${el.tagName.toLowerCase()} unlabeled>`;
        });
      return { url: location.origin + location.pathname, inputs, buttons };
    });
    return (
      `page=${shape.url}; visible inputs: ${shape.inputs.join(", ") || "none"}; ` +
      `visible buttons: ${shape.buttons.join(", ") || "none"}`
    );
  } catch {
    return "couldn't read the login page";
  }
}

// Aspire sessions expire, so a stored cookie jar is only a fast path. When it
// no longer works, log in again with the configured credentials rather than
// failing the search.
async function logIn(page: Page): Promise<{ ok: true } | { ok: false; message: string }> {
  const username = process.env.ASPIRE_USERNAME?.trim();
  const password = process.env.ASPIRE_PASSWORD;
  if (!username || !password) {
    return {
      ok: false,
      message:
        "The stored Aspire session has expired and no ASPIRE_USERNAME/ASPIRE_PASSWORD is configured — " +
        "paste a fresh session at /admin/aspire-session.",
    };
  }

  // Overridable, since Aspire's login markup isn't ours; the defaults cover the
  // usual email + password + submit shape. Hidden matches are filtered out —
  // login pages routinely carry an off-screen form whose submit button can
  // never be clicked, and `.first()` on its own would sit there until timeout.
  const userSelector =
    process.env.ASPIRE_LOGIN_USER_SELECTOR?.trim() ||
    'input[type="email"], input[name="username" i], input[id*="user" i], input[name*="email" i]';
  const passSelector = process.env.ASPIRE_LOGIN_PASS_SELECTOR?.trim() || 'input[type="password"]';
  // Aspire's login form asks for four things, not two: email, password, the
  // tenant's company code, and a device name. Leaving the last two blank is
  // why an otherwise-correct email and password bounced straight back to the
  // login page. The device name is what Aspire remembers a browser by, so it
  // stays constant — a name that changes each run reads as a new device every
  // time and re-triggers device verification.
  const companyCodeSelector =
    process.env.ASPIRE_LOGIN_COMPANY_SELECTOR?.trim() || 'input[name="companyCode"], input[id="companyCode"]';
  const deviceNameSelector =
    process.env.ASPIRE_LOGIN_DEVICE_SELECTOR?.trim() || 'input[name="deviceName"], input[id="deviceName"]';
  const companyCode = process.env.ASPIRE_COMPANY_CODE?.trim();
  const deviceName = process.env.ASPIRE_DEVICE_NAME?.trim() || "VoiceData";
  const submitSelector =
    process.env.ASPIRE_LOGIN_SUBMIT_SELECTOR?.trim() ||
    'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")';

  // Submits exactly once: click the button when there's a clickable one, and
  // otherwise press Enter in the field we just filled. Doing both would
  // double-submit — on a two-step login that carries the first submit through
  // to the second screen's button and skips past the password entirely.
  async function submitForm(filled: ReturnType<Page["locator"]>): Promise<void> {
    const button = page.locator(submitSelector).filter({ visible: true }).first();
    if (await button.isVisible({ timeout: 2_000 }).catch(() => false)) {
      try {
        await button.click({ timeout: 5_000 });
        return;
      } catch {
        // Visible but not actionable (covered, disabled, animating) — Enter
        // is the more reliable path from here.
      }
    }
    await filled.press("Enter");
  }

  // Only fills a field that's actually on the page, so a tenant whose login
  // doesn't ask for one of these isn't broken by the attempt.
  async function fillIfPresent(selector: string, value: string): Promise<boolean> {
    const field = page.locator(selector).filter({ visible: true }).first();
    if (!(await field.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
    await field.fill(value);
    return true;
  }

  try {
    const user = page.locator(userSelector).filter({ visible: true }).first();
    await user.waitFor({ state: "visible", timeout: 10_000 });
    await user.fill(username);

    const pass = page.locator(passSelector).filter({ visible: true }).first();
    // Some tenants split login across two steps (username, then password), so
    // submit once if the password field isn't on screen yet.
    if (!(await pass.isVisible().catch(() => false))) {
      await submitForm(user);
      await pass.waitFor({ state: "visible", timeout: 15_000 });
    }
    await pass.fill(password);

    // The company-code field being on screen with nothing to put in it is a
    // dead end — say so plainly rather than submitting a login that can't
    // succeed and reporting it as a mystery timeout.
    const needsCompanyCode = await page
      .locator(companyCodeSelector)
      .filter({ visible: true })
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (needsCompanyCode && !companyCode) {
      return {
        ok: false,
        message:
          "Aspire's login is asking for a company code and ASPIRE_COMPANY_CODE isn't set — " +
          "add it to the deployment's environment variables.",
      };
    }
    if (companyCode) await fillIfPresent(companyCodeSelector, companyCode);
    await fillIfPresent(deviceNameSelector, deviceName);

    await submitForm(pass);

    if (await waitForLoginToLand(page, LOGIN_TIMEOUT_MS)) return { ok: true };
    // Deliberately not naming a cause. The page's own shape is below — a code
    // field means verification, a still-filled form means the credentials or
    // the company code were rejected, a "Logging in…" button means it simply
    // ran out of time. Guessing MFA here has been wrong every time so far.
    return {
      ok: false,
      message: `Aspire stayed on the login page. [${await describeLoginPage(page)}]`,
    };
  } catch (err) {
    return { ok: false, message: `Aspire login failed: ${briefError(err)} [${await describeLoginPage(page)}]` };
  }
}

// ─── The search itself ───────────────────────────────────────────────────

async function readCandidates(page: Page): Promise<AspireCandidate[]> {
  const rows = page.locator(RESULT_ROW);
  const count = await rows.count();
  const candidates: AspireCandidate[] = [];
  for (let index = 0; index < count; index++) {
    const row = rows.nth(index);
    const title = squish(await row.locator(RESULT_TITLE).first().textContent().catch(() => null));
    const subtitle = squish(await row.locator(RESULT_SUBTITLE).first().textContent().catch(() => null));
    if (title) candidates.push({ index, title, subtitle });
  }
  return candidates;
}

// The search box exists but is off screen. Aspire is a PrimeNG app, so the
// collapsed control is an icon button — try the usual ways one is marked up,
// then re-check. Only ever clicks something that looks like a search control.
const SEARCH_TOGGLE =
  '[aria-label*="search" i], [title*="search" i], .pi-search, .fa-search, [class*="search-icon" i], [class*="searchIcon" i]';

async function revealSearchBox(page: Page): Promise<boolean> {
  const input = page.locator(SEARCH_INPUT).first();
  const toggles = page.locator(SEARCH_TOGGLE).filter({ visible: true });
  const count = Math.min(await toggles.count().catch(() => 0), 3);
  for (let i = 0; i < count; i++) {
    await toggles.nth(i).click({ timeout: 3_000 }).catch(() => {});
    if (await input.isVisible({ timeout: 2_000 }).catch(() => false)) return true;
  }
  return false;
}

// Page shape for when the search box can't be found — the counterpart to
// describeLoginPage, but it also reports elements that exist while hidden,
// which is exactly the distinction that matters here.
async function describePage(page: Page): Promise<string> {
  try {
    return await page.evaluate((selector: string) => {
      const onScreen = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const target = document.querySelector(selector);
      // Everything an input carries that a selector could key on. The
      // previous version printed only name-or-id-or-type, which reduced a
      // page-level search box to the bare word "text" — true, and useless.
      const inputs = Array.from(document.querySelectorAll("input"))
        .slice(0, 12)
        .map((el) => {
          const bits = [el.type || "text"];
          if (el.name) bits.push(`name=${el.name}`);
          if (el.id) bits.push(`id=${el.id}`);
          const placeholder = el.getAttribute("placeholder");
          if (placeholder) bits.push(`placeholder="${placeholder.slice(0, 30)}"`);
          const aria = el.getAttribute("aria-label");
          if (aria) bits.push(`aria-label="${aria.slice(0, 30)}"`);
          const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
          if (cls) bits.push(`class=${cls}`);
          if (!onScreen(el)) bits.push("hidden");
          return `input[${bits.join(" ")}]`;
        });
      return (
        `page=${location.origin + location.pathname}; ` +
        `viewport=${window.innerWidth}x${window.innerHeight}; ` +
        `search box: ${target ? (onScreen(target) ? "visible" : "in DOM but hidden") : "not in DOM"}; ` +
        `inputs: ${inputs.slice(0, 12).join(", ") || "none"}`
      );
    }, SEARCH_INPUT);
  } catch {
    return "couldn't read the page";
  }
}

// When nothing matched, report what the page actually holds: how many rows the
// configured row selector found, and — more useful — every element whose text
// contains the number, with its tag, classes, and whether it's a real link.
// On a page whose markup isn't known yet that's enough to read the right
// selectors straight off one failed run, instead of guessing at them.
async function describeResults(page: Page, needle: string): Promise<string> {
  try {
    return await page.evaluate(
      ({ rowSelector, needleText }: { rowSelector: string; needleText: string }) => {
        const rows = document.querySelectorAll(rowSelector).length;
        const hits = Array.from(document.querySelectorAll("a, div, td, span, li"))
          .filter((el) => {
            if (!(el.textContent || "").includes(needleText)) return false;
            // Keep the innermost matches; an ancestor chain all "contains" it.
            return !Array.from(el.children).some((child) =>
              (child.textContent || "").includes(needleText)
            );
          })
          .slice(0, 6)
          .map((el) => {
            const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
            const href = el.getAttribute("href");
            const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
            return `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${href ? ` href=${href}` : ""}> "${text}"`;
          });
        // What state the search left the page in — the part that tells a "the
        // search ran and found nothing" apart from "the search never ran".
        // A grid that answered shows either rows or its empty-state banner;
        // a page that ignored the keystrokes shows neither, and an input
        // whose value is empty says the typing itself didn't stick.
        const gridRows = document.querySelectorAll(
          '[class*="ag-row"]:not([class*="ag-header"]), [role="row"], tbody tr'
        ).length;
        const active = document.activeElement as HTMLInputElement | null;
        const inputValues = Array.from(document.querySelectorAll("input"))
          .filter((el) => el.value && el.type !== "checkbox")
          .slice(0, 4)
          .map((el) => `"${el.value.slice(0, 24)}"${el === active ? " (focused)" : ""}`);
        const bodyText = (document.body.innerText || "").replace(/\s+/g, " ").trim();
        const emptyState = /no (rows|results|records|matches|data)/i.exec(bodyText)?.[0] ?? null;
        return (
          `url=${location.pathname}${location.search}; ` +
          `rows matching "${rowSelector}": ${rows}; grid-ish rows on page: ${gridRows}; ` +
          `empty-state text: ${emptyState ? `"${emptyState}"` : "none"}; ` +
          `inputs holding text: ${inputValues.join(", ") || "none"}; ` +
          `elements containing the number: ${hits.join(" | ") || "none"}; ` +
          `page text starts: "${bodyText.slice(0, 180)}"`
        );
      },
      { rowSelector: RESULT_ROW, needleText: needle }
    );
  } catch {
    return "couldn't read the results";
  }
}

// True once any element's text contains the number. Deliberately not tied to
// RESULT_ROW: whether results appeared and whether our row selector describes
// them are separate questions, and conflating them made a markup mismatch
// read as "no results".
async function resultsAppeared(page: Page, needle: string, timeout: number): Promise<boolean> {
  return page
    .waitForFunction(
      (needleText: string) => {
        // Text nodes only, skipping script/style: body.textContent includes
        // script source, and Angular apps embed serialized state there — a
        // needle "found" in a JSON blob is not a result on screen.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const tag = node.parentElement?.tagName;
            return tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT"
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT;
          },
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.nodeValue?.includes(needleText)) return true;
        }
        return false;
      },
      needle,
      { timeout }
    )
    .then(() => true)
    .catch(() => false);
}

// One-line description of the input the search text went into — which matters
// on a page with a dozen inputs, where "typed it somewhere" isn't evidence.
async function describeInput(input: ReturnType<Page["locator"]>): Promise<string> {
  return input
    .evaluate((el: HTMLInputElement) => {
      const bits = [el.type || "text"];
      if (el.name) bits.push(`name=${el.name}`);
      if (el.id) bits.push(`id=${el.id}`);
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) bits.push(`placeholder="${placeholder.slice(0, 30)}"`);
      const aria = el.getAttribute("aria-label");
      if (aria) bits.push(`aria-label="${aria.slice(0, 30)}"`);
      return `input[${bits.join(" ")}]`;
    })
    .catch(() => "unknown input");
}

// Anchors with a real href whose own text carries the proposal number —
// innermost matches only, so an ancestor wrapping the whole row doesn't
// drown out the link itself. Skips javascript: and fragment-only hrefs,
// which are click handlers wearing an <a> tag.
async function findResultLinks(page: Page, needle: string): Promise<{ href: string; text: string }[]> {
  try {
    return await page.evaluate((needleText: string) => {
      return Array.from(document.querySelectorAll("a[href]"))
        .filter((el) => {
          const href = el.getAttribute("href") || "";
          if (!href || href.startsWith("#") || href.startsWith("javascript:")) return false;
          return (el.textContent || "").includes(needleText);
        })
        .slice(0, 6)
        .map((el) => ({
          href: el.getAttribute("href") || "",
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        }));
    }, needle);
  } catch {
    return [];
  }
}

// Resolve a (possibly relative) href against the page, falling back to the
// Aspire origin if the page's own URL can't serve as a base.
function resolveHref(href: string, pageUrl: string): string {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return new URL(href, ASPIRE_BASE_URL).toString();
  }
}

async function runSearch(page: Page, options: AspireSearchOptions): Promise<AspireSearchResult> {
  const { proposalNumber, resultIndex } = options;

  const input = page.locator(SEARCH_INPUT).first();
  try {
    await input.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    // In the DOM but not on screen: Aspire (a PrimeNG app) tucks the search
    // behind an icon when the header is tight. Click the icon and try again
    // before giving up.
    const revealed = await revealSearchBox(page);
    if (!revealed) {
      return {
        ok: false,
        code: "search_unavailable",
        message:
          `Aspire's search box (${SEARCH_INPUT}) never became visible. [${await describePage(page)}]`,
      };
    }
  }
  await input.click();
  await input.fill("");
  // Typed rather than filled: a live filter listens for keystrokes, and a
  // single programmatic value-set can leave a debounced filter unfired.
  await input.pressSequentially(proposalNumber, { delay: 40 });

  // The nav box filters live as you type; a page-level search (the
  // opportunities grid) sits inert until Enter runs it. Give the live filter
  // a few seconds, and if nothing surfaced, press Enter and wait properly —
  // in production the typed number produced no element containing it at all
  // until this distinction was drawn.
  let appeared = await resultsAppeared(page, proposalNumber, 5_000);
  if (!appeared) {
    await input.press("Enter");
    appeared = await resultsAppeared(page, proposalNumber, RESULT_TIMEOUT_MS);
  }
  if (!appeared) {
    return {
      ok: false,
      code: "no_match",
      message:
        `Aspire's search returned nothing for "${proposalNumber}" ` +
        `(typed into ${await describeInput(input)}, then pressed Enter). ` +
        `[${await describeResults(page, proposalNumber)}]`,
    };
  }
  await page.waitForTimeout(DEBOUNCE_SETTLE_MS);

  const all = await readCandidates(page);
  // Prefer rows whose leading `#number` IS the proposal number; fall back to
  // rows that merely contain it (a number can appear inside a longer one, or
  // in the property line).
  const exact = all.filter((c) => leadingNumber(c.title) === proposalNumber);
  const loose = all.filter((c) => `${c.title} ${c.subtitle}`.includes(proposalNumber));
  const matches = exact.length > 0 ? exact : loose;

  if (matches.length === 0) {
    // Results are on the page (the number's there) but the configured row
    // selector doesn't describe them — the shape of a search page we haven't
    // mapped, like the opportunities grid. If those results are real links,
    // their href IS the answer: no row selectors, no clicking, no waiting on
    // a navigation. The nav dropdown needed the click path only because its
    // rows have no href.
    const links = await findResultLinks(page, proposalNumber);
    if (links.length === 1) {
      return { ok: true, url: resolveHref(links[0].href, page.url()), title: links[0].text };
    }
    if (links.length > 1) {
      if (resultIndex !== undefined && links[resultIndex]) {
        return { ok: true, url: resolveHref(links[resultIndex].href, page.url()), title: links[resultIndex].text };
      }
      return {
        ok: false,
        code: "ambiguous",
        message: `${links.length} Aspire links matched #${proposalNumber} — pick the right one`,
        candidates: links.map((l, index) => ({ index, title: l.text, subtitle: l.href })),
      };
    }
    return {
      ok: false,
      code: "no_match",
      message:
        `No Aspire result matched proposal #${proposalNumber}. ` +
        `[${await describeResults(page, proposalNumber)}]`,
    };
  }

  let chosen = matches[0];
  if (matches.length > 1) {
    // More than one proposal can carry the same number across tenants/versions.
    // Rather than guess, hand the list back and let the caller pick.
    if (resultIndex === undefined) {
      return {
        ok: false,
        code: "ambiguous",
        message: `${matches.length} Aspire results matched #${proposalNumber} — pick the right one`,
        candidates: matches,
      };
    }
    const picked = matches.find((c) => c.index === resultIndex);
    if (!picked) {
      return {
        ok: false,
        code: "ambiguous",
        message: "That result is no longer in Aspire's list — search again",
        candidates: matches,
      };
    }
    chosen = picked;
  }

  const before = page.url();
  await page.locator(RESULT_ROW).nth(chosen.index).locator(RESULT_TITLE).first().click();

  try {
    await page.waitForFunction((previous: string) => window.location.href !== previous, before, {
      timeout: NAVIGATION_TIMEOUT_MS,
    });
  } catch {
    return {
      ok: false,
      code: "navigation_failed",
      message: "Clicked the Aspire result but the page never navigated",
    };
  }
  // Angular routes client-side, so there may be no load event to wait on —
  // settle on network quiet, and don't treat a busy app as a failure.
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

  return { ok: true, url: page.url(), title: chosen.title };
}

// ─── Entry point ─────────────────────────────────────────────────────────

export async function searchAspireProposal(options: AspireSearchOptions): Promise<AspireSearchResult> {
  const acquired = await acquireBrowser();
  if ("error" in acquired) {
    return { ok: false, code: "browser_unavailable", message: acquired.error };
  }

  const { browser } = acquired;
  const { context, ownsContext } = await openContext(browser);
  let page: Page | null = null;

  try {
    const hadSession = await applyStoredSession(context);
    page = await context.newPage();
    await forceViewport(context, page);
    page.setDefaultTimeout(RESULT_TIMEOUT_MS);
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });

    if (!(await isSignedIn(page, hadSession ? SIGNED_IN_TIMEOUT_MS : 5_000))) {
      const login = await logIn(page);
      if (!login.ok) {
        return {
          ok: false,
          code: hadSession ? "login_failed" : "session_missing",
          message: login.message,
        };
      }
    }

    // A fresh login lands wherever Aspire sends it, which isn't necessarily the
    // page the search runs on.
    if (SEARCH_URL !== ASPIRE_BASE_URL && !page.url().startsWith(SEARCH_URL)) {
      await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
    }

    const result = await runSearch(page, options);
    if (result.ok) await persistSession(context);
    return result;
  } catch (err) {
    return { ok: false, code: "unexpected", message: briefError(err) };
  } finally {
    await page?.close().catch(() => {});
    if (ownsContext) await context.close().catch(() => {});
    // Closes a locally launched browser; disconnects from a remote one.
    await browser.close().catch(() => {});
  }
}

// Cheap "is the stored session still good?" probe for the admin page: opens
// Aspire and reports whether the search box came up without a login.
export async function checkAspireSession(): Promise<{ ok: boolean; message: string }> {
  const acquired = await acquireBrowser();
  if ("error" in acquired) return { ok: false, message: acquired.error };

  const { browser } = acquired;
  const { context, ownsContext } = await openContext(browser);
  let page: Page | null = null;
  try {
    const hadSession = await applyStoredSession(context);
    page = await context.newPage();
    await forceViewport(context, page);
    await page.goto(ASPIRE_BASE_URL, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
    const signedIn = await isSignedIn(page, SIGNED_IN_TIMEOUT_MS);
    if (signedIn) await persistSession(context);
    return {
      ok: signedIn,
      message: signedIn
        ? "Aspire's search box loaded — the session is live."
        : hadSession
          ? "The stored session no longer signs in to Aspire — paste a fresh one."
          : "No stored session, and Aspire didn't sign in on its own.",
    };
  } catch (err) {
    return { ok: false, message: briefError(err) };
  } finally {
    await page?.close().catch(() => {});
    if (ownsContext) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
