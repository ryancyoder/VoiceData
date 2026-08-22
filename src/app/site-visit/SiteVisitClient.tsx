"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MicButton from "@/components/MicButton";
import type { ChecklistState, SiteVisitContext, SiteVisitSession, SiteVisitTurn } from "@/lib/siteVisit";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface PickerDeal {
  id: number;
  deal_name: string;
  company: string | null;
  stage: string;
  value: number | null;
  address: string | null;
  contact_last_name: string | null;
}

interface SessionView {
  session: SiteVisitSession;
  brief: string;
  checklist: ChecklistState[];
  context: SiteVisitContext;
}

interface QuestionStat {
  slug: string;
  label: string;
  asked: number;
  answered: number;
  sessions: number;
  session_share: number;
  distinct_phrasings: number;
  last_asked: string;
}

type Status = "idle" | "thinking" | "speaking";

export default function SiteVisitClient() {
  const [deals, setDeals] = useState<PickerDeal[] | null>(null);
  const [openSessions, setOpenSessions] = useState<{ id: number; deal_id: number }[]>([]);
  const [view, setView] = useState<SessionView | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [starting, setStarting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [voice, setVoice] = useState(true);
  const [log, setLog] = useState<{ totalSessions: number; questions: QuestionStat[] } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);

  const loadDeals = useCallback(() => {
    fetch("/api/site-visit")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setDeals(d.deals ?? []);
        setOpenSessions(d.openSessions ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load deals"));
  }, []);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  // Only fetched when the panel is actually opened — it is a review tool, not
  // something the picker needs on every load.
  useEffect(() => {
    if (!showLog || log) return;
    fetch("/api/site-visit/questions")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setLog({ totalSessions: d.totalSessions ?? 0, questions: d.questions ?? [] });
      })
      .catch(() => setLog({ totalSessions: 0, questions: [] }));
  }, [showLog, log]);

  const turns = useMemo(
    () => (view?.session.turns ?? []).filter((t) => !t.hidden),
    [view]
  );

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length]);

  const speak = useCallback(
    (text: string) => {
      if (!voice || !text) return;
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setStatus("speaking");
      utterance.onend = () => setStatus("idle");
      utterance.onerror = () => setStatus("idle");
      window.speechSynthesis.speak(utterance);
    },
    [voice]
  );

  async function startVisit(dealId: number) {
    setStarting(dealId);
    setError(null);
    try {
      const res = await fetch("/api/site-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start the visit");
      setView(data);
      const last = (data.session.turns as SiteVisitTurn[]).filter((t) => t.role === "assistant").at(-1);
      if (last) speak(last.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the visit");
    } finally {
      setStarting(null);
    }
  }

  async function send(text: string) {
    if (!view || !text.trim() || status === "thinking") return;
    const sessionId = view.session.id;
    setError(null);
    setStatus("thinking");
    // Optimistically show what was just said, so a slow turn doesn't look dead.
    setView((v) =>
      v
        ? {
            ...v,
            session: {
              ...v.session,
              turns: [...v.session.turns, { role: "user", content: text, at: new Date().toISOString() }],
            },
          }
        : v
    );
    try {
      const res = await fetch(`/api/site-visit/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That turn didn't go through");
      setView(data);
      speak(data.reply);
      if (!voice) setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That turn didn't go through");
      setStatus("idle");
    }
  }

  async function finish() {
    if (!view) return;
    setStatus("thinking");
    setError(null);
    try {
      const res = await fetch(`/api/site-visit/${view.session.id}/close`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't close the visit out");
      setView(data);
      if (data.summaryError) setError(`Visit closed, but the summary failed: ${data.summaryError}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't close the visit out");
    } finally {
      setStatus("idle");
    }
  }

  function leave() {
    window.speechSynthesis?.cancel();
    setView(null);
    setStatus("idle");
    setError(null);
    loadDeals();
  }

  // ─── Deal picker ───────────────────────────────────────────────────────────
  if (!view) {
    const q = query.trim().toLowerCase();
    const filtered = (deals ?? []).filter((d) =>
      !q
        ? true
        : [d.deal_name, d.company, d.address, d.contact_last_name].some((f) => f?.toLowerCase().includes(q))
    );
    const openByDeal = new Set(openSessions.map((s) => s.deal_id));

    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Site Visit</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pick the deal you&apos;re standing at. Its contact, scope, history, and whatever earlier visits
          established get loaded before you say a word — the conversation only covers what&apos;s still missing.
        </p>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search deals, addresses, contacts…"
          className="mt-5 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />

        {deals === null ? (
          <p className="mt-6 text-sm text-zinc-500">Loading deals…</p>
        ) : filtered.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">No deals match that.</p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {filtered.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={starting != null}
                  onClick={() => startVisit(d.id)}
                  className="flex w-full flex-col items-start gap-1 rounded-xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{d.deal_name}</span>
                    {openByDeal.has(d.id) && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        in progress
                      </span>
                    )}
                    {starting === d.id && <span className="ml-auto text-xs text-zinc-500">Loading context…</span>}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {d.address || "no address on file"}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {d.stage}
                    {d.value != null ? ` · ${currency.format(d.value)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            {showLog ? "▾" : "▸"} Question log
          </button>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Which questions come up on every visit, and how consistently they&apos;re worded. A question asked
            in nearly every visit with one settled phrasing has earned a fixed field of its own.
          </p>
          {showLog &&
            (log === null ? (
              <p className="mt-3 text-sm text-zinc-500">Loading…</p>
            ) : log.questions.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">
                Nothing logged yet — the log fills in as visits are run.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="text-left text-xs tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Question</th>
                      <th className="py-1 pr-3 font-medium">Visits</th>
                      <th className="py-1 pr-3 font-medium">Answered</th>
                      <th className="py-1 font-medium">Phrasings</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-700 dark:text-zinc-300">
                    {log.questions.map((q) => (
                      <tr key={q.slug} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5 pr-3">{q.label}</td>
                        <td className="py-1.5 pr-3">
                          {q.sessions} of {log.totalSessions} ({Math.round(q.session_share * 100)}%)
                        </td>
                        <td className="py-1.5 pr-3">
                          {q.answered} of {q.asked}
                        </td>
                        <td className="py-1.5">{q.distinct_phrasings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
      </main>
    );
  }

  // ─── Live session ──────────────────────────────────────────────────────────
  const { session, checklist, context } = view;
  const gaps = checklist.filter((c) => c.known == null);
  const closed = session.status === "closed";
  const busy = status === "thinking";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={leave}
            className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ‹ Deals
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {context.deal.deal_name}
            </h1>
            <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
              {context.property?.address ?? "no address on file"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
              Speak replies
            </label>
            {!closed && (
              <button
                type="button"
                onClick={finish}
                disabled={busy}
                className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Finish visit
              </button>
            )}
          </div>
        </header>

        {closed && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Visit closed out</p>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
              {session.summary || "No summary was written."}
            </p>
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

        <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {turns.length === 0 && (
            <p className="text-sm text-zinc-500">Nothing said yet — hit the mic and start talking.</p>
          )}
          {turns.map((t, i) => (
            <div
              key={`${t.at}-${i}`}
              className={t.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <p
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
                  t.role === "user"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {t.content}
              </p>
            </div>
          ))}
          {busy && <p className="text-sm text-zinc-500">Thinking…</p>}
          <div ref={transcriptEnd} />
        </div>

        {!closed && (
          <div className="mt-4 flex items-center gap-3">
            <MicButton
              disabled={busy}
              onTranscript={(text) => send(text)}
              onError={(m) => setError(m)}
            />
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = typed;
                setTyped("");
                send(t);
              }}
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy}
                placeholder="…or type it"
                className="flex-1 rounded-full border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                type="submit"
                disabled={busy || !typed.trim()}
                className="rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Send
              </button>
            </form>
          </div>
        )}
      </section>

      <aside className="w-full shrink-0 lg:w-80">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Checklist
          <span className="ml-2 font-normal text-zinc-500">
            {gaps.length} gap{gaps.length === 1 ? "" : "s"} left
          </span>
        </h2>
        <ul className="mt-3 space-y-2">
          {checklist.map((c) => (
            <li
              key={c.slug}
              className={`rounded-lg border p-3 ${
                c.known != null
                  ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                  : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                <span aria-hidden="true">{c.known != null ? "✓" : "○"}</span>
                {c.label}
                {c.storage === "log" && (
                  <span
                    title="No column backs this yet — answers live in the question log until it has hardened"
                    className="ml-auto text-[10px] font-normal tracking-wide text-zinc-400 uppercase"
                  >
                    log
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                {c.known != null ? c.known : c.ask}
              </p>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
