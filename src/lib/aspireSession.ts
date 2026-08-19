import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { getSetting, setSetting } from "@/lib/appSettings";

// ─── Aspire session storage ──────────────────────────────────────────────
//
// The headless-browser search (see aspireBrowser.ts) needs a logged-in Aspire
// session. Those cookies are as good as a password, so they never live in the
// repo, in an env var, or in plaintext in the database: they're encrypted with
// AES-256-GCM under ASPIRE_SESSION_SECRET and parked in the existing
// app_settings key/value table. Without that secret the app refuses to store a
// session at all rather than falling back to plaintext.

// Aspire's origin lives here rather than next to the browser driver: the
// cookie jar needs it to know which domain to scope cookies to, and pulling it
// from here keeps the session module free of any browser dependency.
export const ASPIRE_BASE_URL = (process.env.ASPIRE_BASE_URL || "https://cloud.youraspire.com").replace(/\/+$/, "");

export const ASPIRE_SESSION_KEY = "aspire_session_state";
export const ASPIRE_LAST_ERROR_KEY = "aspire_search_last_error";

// scrypt needs a salt. It's fixed (not secret — a salt never is) because the
// value has to derive the same key on every serverless invocation, and the
// thing it's guarding against, an attacker with database read access, is
// already blocked by not having ASPIRE_SESSION_SECRET at all.
const KEY_SALT = "voicedata:aspire-session:v1";
const ENVELOPE_PREFIX = "v1";

export interface AspireCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface AspireSession {
  cookies: AspireCookie[];
  savedAt: string;
}

export interface AspireFailure {
  at: string;
  code: string;
  message: string;
  proposalNumber?: string;
}

function secret(): string | null {
  const value = process.env.ASPIRE_SESSION_SECRET?.trim();
  return value ? value : null;
}

export function hasSessionSecret(): boolean {
  return secret() !== null;
}

function keyFrom(value: string): Buffer {
  return scryptSync(value, KEY_SALT, 32);
}

export function encryptSecret(plain: string): string {
  const value = secret();
  if (!value) throw new Error("ASPIRE_SESSION_SECRET is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(value), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_PREFIX, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(":");
}

export function decryptSecret(envelope: string): string | null {
  const value = secret();
  if (!value) return null;
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(value), Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong secret, or the stored blob was tampered with. Either way there's
    // no usable session — the caller re-authenticates instead of crashing.
    return null;
  }
}

export async function loadAspireSession(): Promise<AspireSession | null> {
  const stored = await getSetting(ASPIRE_SESSION_KEY);
  if (!stored) return null;
  const plain = decryptSecret(stored);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as AspireSession;
    if (!Array.isArray(parsed.cookies) || parsed.cookies.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveAspireSession(cookies: AspireCookie[]): Promise<{ error: string | null }> {
  if (!hasSessionSecret()) {
    return { error: "ASPIRE_SESSION_SECRET is not set — refusing to store Aspire cookies unencrypted" };
  }
  if (cookies.length === 0) return { error: "No cookies to store" };
  const payload: AspireSession = { cookies, savedAt: new Date().toISOString() };
  return setSetting(ASPIRE_SESSION_KEY, encryptSecret(JSON.stringify(payload)));
}

export async function clearAspireSession(): Promise<{ error: string | null }> {
  return setSetting(ASPIRE_SESSION_KEY, null);
}

// ─── Failure log ─────────────────────────────────────────────────────────
//
// This whole flow runs headless on a server, so a swallowed error is an error
// nobody ever sees. Every failure lands in three places: the server log, the
// response the button renders inline, and this row — which /admin/aspire-session
// shows, so a failure from days ago is still findable.

export async function recordAspireFailure(
  code: string,
  message: string,
  proposalNumber?: string
): Promise<void> {
  const entry: AspireFailure = { at: new Date().toISOString(), code, message, proposalNumber };
  console.error(`[aspire-search] ${code}: ${message}${proposalNumber ? ` (proposal ${proposalNumber})` : ""}`);
  await setSetting(ASPIRE_LAST_ERROR_KEY, JSON.stringify(entry));
}

export async function clearAspireFailure(): Promise<void> {
  await setSetting(ASPIRE_LAST_ERROR_KEY, null);
}

export async function readAspireFailure(): Promise<AspireFailure | null> {
  const stored = await getSetting(ASPIRE_LAST_ERROR_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AspireFailure;
  } catch {
    return null;
  }
}

// ─── Cookie parsing ──────────────────────────────────────────────────────

// Accepts either a Playwright/DevTools storage-state JSON blob
// (`{"cookies":[...]}` or a bare array) or a raw `Cookie:` request header
// copied out of the browser's network panel — whichever is easier to grab.
export function parseCookieInput(input: string, defaultDomain: string): AspireCookie[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("That looked like JSON but wouldn't parse");
    }
    const raw = Array.isArray(parsed)
      ? parsed
      : ((parsed as { cookies?: unknown }).cookies as unknown);
    if (!Array.isArray(raw)) throw new Error("No `cookies` array found in that JSON");
    return raw
      .map((c) => c as Record<string, unknown>)
      .filter((c) => typeof c.name === "string" && typeof c.value === "string")
      .map((c) => ({
        name: c.name as string,
        value: c.value as string,
        domain: typeof c.domain === "string" && c.domain ? c.domain : defaultDomain,
        path: typeof c.path === "string" && c.path ? c.path : "/",
        expires: typeof c.expires === "number" ? c.expires : undefined,
        httpOnly: typeof c.httpOnly === "boolean" ? c.httpOnly : undefined,
        secure: typeof c.secure === "boolean" ? c.secure : undefined,
        sameSite: c.sameSite === "Strict" || c.sameSite === "Lax" || c.sameSite === "None" ? c.sameSite : undefined,
      }));
  }

  // Raw header form: `name=value; other=value`.
  return trimmed
    .replace(/^cookie:\s*/i, "")
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair): AspireCookie | null => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return null;
      return {
        name: pair.slice(0, eq).trim(),
        value: pair.slice(eq + 1).trim(),
        domain: defaultDomain,
        path: "/",
      };
    })
    .filter((c): c is AspireCookie => c !== null);
}

// ─── Readiness ───────────────────────────────────────────────────────────

export interface AspireSessionStatus {
  baseUrl: string;
  hasSecret: boolean;
  hasSession: boolean;
  savedAt: string | null;
  cookieNames: string[];
  browserConfigured: boolean;
  credentialsConfigured: boolean;
  lastError: AspireFailure | null;
}

// Everything /admin/aspire-session needs to say whether a search would work
// right now. Cookie VALUES never leave the server — only their names.
export async function aspireSessionStatus(): Promise<AspireSessionStatus> {
  const session = await loadAspireSession();
  return {
    baseUrl: ASPIRE_BASE_URL,
    hasSecret: hasSessionSecret(),
    hasSession: session !== null,
    savedAt: session?.savedAt ?? null,
    cookieNames: session?.cookies.map((c) => c.name) ?? [],
    browserConfigured: Boolean(
      process.env.ASPIRE_BROWSER_WS_ENDPOINT?.trim() || process.env.ASPIRE_BROWSER_EXECUTABLE?.trim()
    ),
    credentialsConfigured: Boolean(process.env.ASPIRE_USERNAME?.trim() && process.env.ASPIRE_PASSWORD),
    lastError: await readAspireFailure(),
  };
}
