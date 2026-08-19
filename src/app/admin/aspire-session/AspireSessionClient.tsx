"use client";

import { useState } from "react";
import Link from "next/link";

import type { AspireSessionStatus } from "@/lib/aspireSession";

const CARD = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
const BUTTON =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100";

function Flag({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden>{ok ? "✅" : "⚠️"}</span>
      <span className={ok ? "text-zinc-700 dark:text-zinc-300" : "text-amber-700 dark:text-amber-400"}>{children}</span>
    </li>
  );
}

export default function AspireSessionClient({ initialStatus }: { initialStatus: AspireSessionStatus }) {
  const [status, setStatus] = useState<AspireSessionStatus>(initialStatus);
  const [cookies, setCookies] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test" | "clear">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/aspire-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't store that session");
      setStatus(data.status);
      setCookies("");
      setMessage(`Stored ${data.saved} cookie${data.saved === 1 ? "" : "s"}, encrypted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't store that session");
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/aspire-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json();
      if (data.status) setStatus(data.status);
      if (!res.ok) throw new Error(data.error || "The test couldn't run");
      if (data.ok) setMessage(data.message);
      else setError(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The test couldn't run");
    } finally {
      setBusy("");
    }
  }

  async function clear() {
    if (!window.confirm("Delete the stored Aspire session? The next search will have to log in again.")) return;
    setBusy("clear");
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/aspire-session", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't clear the session");
      setStatus(data.status);
      setMessage("Stored session deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clear the session");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-1 flex-col gap-6 bg-zinc-50 p-6 font-sans dark:bg-black">
      <header>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Aspire session</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The &ldquo;Find in Aspire&rdquo; button on a deal drives a headless browser through Aspire&apos;s
          search box, which needs a logged-in session. Store one here; it&apos;s encrypted before it touches
          the database.{" "}
          <Link href="/sales-board" className="underline">
            ← Sales Board
          </Link>
        </p>
      </header>

      <section className={CARD}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Readiness</h2>
        <ul className="mt-3 flex flex-col gap-2">
          <Flag ok={status.hasSecret}>
            {status.hasSecret
              ? "ASPIRE_SESSION_SECRET is set — sessions are encrypted at rest."
              : "ASPIRE_SESSION_SECRET is not set. Sessions can't be stored until it is."}
          </Flag>
          <Flag ok={status.browserConfigured}>
            {status.browserConfigured
              ? "A headless browser is configured."
              : "No ASPIRE_BROWSER_WS_ENDPOINT or ASPIRE_BROWSER_EXECUTABLE — searches fall back to a locally installed Chromium, which serverless hosts don't have."}
          </Flag>
          <Flag ok={status.hasSession}>
            {status.hasSession
              ? `Session stored ${new Date(status.savedAt || "").toLocaleString()} (${status.cookieNames.length} cookies).`
              : "No session stored yet."}
          </Flag>
          <Flag ok={status.credentialsConfigured}>
            {status.credentialsConfigured
              ? "ASPIRE_USERNAME / ASPIRE_PASSWORD are set — expired sessions re-authenticate on their own."
              : "No ASPIRE_USERNAME / ASPIRE_PASSWORD, so an expired session has to be re-pasted here by hand."}
          </Flag>
          {status.liveView && (
            <li className="flex items-start gap-2 text-sm">
              <span aria-hidden>👁</span>
              <span className="text-zinc-700 dark:text-zinc-300">
                A run is in progress —{" "}
                <a href={status.liveView.url} target="_blank" rel="noopener noreferrer" className="underline">
                  watch it live
                </a>
                {status.liveView.note ? ` — ${status.liveView.note}` : ""}
              </span>
            </li>
          )}
          <li className="text-xs text-zinc-500 dark:text-zinc-400">Aspire: {status.baseUrl}</li>
        </ul>
      </section>

      {status.lastError && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Last failure</h2>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{status.lastError.message}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {status.lastError.code}
            {status.lastError.proposalNumber ? ` · proposal #${status.lastError.proposalNumber}` : ""} ·{" "}
            {new Date(status.lastError.at).toLocaleString()}
          </p>
        </section>
      )}

      <section className={CARD}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Store a session</h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Sign in to Aspire in your own browser, then paste either the whole <code>Cookie:</code> request
          header from the network panel, or a Playwright storage-state JSON blob. Values are encrypted with
          AES-256-GCM and never shown again.
        </p>
        <textarea
          value={cookies}
          onChange={(e) => setCookies(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder="ASP.NET_SessionId=…; .AspNet.ApplicationCookie=…"
          className="mt-3 w-full rounded-md border border-zinc-300 bg-white p-2 font-mono text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BUTTON} onClick={save} disabled={!cookies.trim() || busy !== ""}>
            {busy === "save" ? "Storing…" : "Store session"}
          </button>
          <button type="button" className={BUTTON} onClick={test} disabled={busy !== ""}>
            {busy === "test" ? "Testing…" : "Test session"}
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={clear}
            disabled={busy !== "" || !status.hasSession}
          >
            {busy === "clear" ? "Clearing…" : "Clear stored session"}
          </button>
        </div>
        {message && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </section>
    </div>
  );
}
