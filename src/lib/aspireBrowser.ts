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
const SEARCH_INPUT = 'input[name="searchAspire"]';
const RESULT_ROW = ".search-result";
const RESULT_TITLE = "a.pointer:not(.result-sub-name)";
const RESULT_SUBTITLE = "a.result-sub-name";

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const SIGNED_IN_TIMEOUT_MS = 20_000;
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
async function acquireBrowser(): Promise<AcquiredBrowser | { error: string }> {
  const endpoint = process.env.ASPIRE_BROWSER_WS_ENDPOINT?.trim();
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

async function isSignedIn(page: Page, timeout: number): Promise<boolean> {
  try {
    await page.waitForSelector(SEARCH_INPUT, { state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
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
    await submitForm(pass);

    if (await isSignedIn(page, LOGIN_TIMEOUT_MS)) return { ok: true };
    return {
      ok: false,
      message:
        "Filled in the login but Aspire's search box never appeared — it may be asking for an MFA code. " +
        `[${await describeLoginPage(page)}]`,
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

async function runSearch(page: Page, options: AspireSearchOptions): Promise<AspireSearchResult> {
  const { proposalNumber, resultIndex } = options;

  const input = page.locator(SEARCH_INPUT).first();
  try {
    await input.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return {
      ok: false,
      code: "search_unavailable",
      message: `Aspire's search box (${SEARCH_INPUT}) wasn't on the page — the selector may have changed`,
    };
  }
  await input.click();
  await input.fill("");
  // Typed rather than filled: the result list filters on keystrokes, so a
  // single programmatic value-set can leave a debounced filter unfired.
  await input.pressSequentially(proposalNumber, { delay: 40 });

  // Results filter live as you type — no Enter, no search button — so this
  // waits for the list to contain the number rather than for a navigation.
  try {
    await page.waitForFunction(
      ({ selector, needle }: { selector: string; needle: string }) =>
        Array.from(document.querySelectorAll(selector)).some((el) =>
          (el.textContent || "").replace(/\s+/g, " ").includes(needle)
        ),
      { selector: RESULT_ROW, needle: proposalNumber },
      { timeout: RESULT_TIMEOUT_MS }
    );
  } catch {
    return {
      ok: false,
      code: "no_match",
      message: `Aspire's search returned nothing for "${proposalNumber}"`,
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
    return { ok: false, code: "no_match", message: `No Aspire result matched proposal #${proposalNumber}` };
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
  // A remote Chromium hands back a live default context; a freshly launched
  // one has none, so create it (and only then own closing it).
  const existing = browser.contexts()[0];
  const context = existing ?? (await browser.newContext());
  const ownsContext = !existing;
  let page: Page | null = null;

  try {
    const hadSession = await applyStoredSession(context);
    page = await context.newPage();
    page.setDefaultTimeout(RESULT_TIMEOUT_MS);
    await page.goto(ASPIRE_BASE_URL, { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });

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
  const existing = browser.contexts()[0];
  const context = existing ?? (await browser.newContext());
  const ownsContext = !existing;
  let page: Page | null = null;
  try {
    const hadSession = await applyStoredSession(context);
    page = await context.newPage();
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
