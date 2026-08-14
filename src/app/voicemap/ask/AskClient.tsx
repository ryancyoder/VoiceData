"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import WikiMarkdown from "../wiki/WikiMarkdown";

interface Source {
  n: number;
  label: string;
  topic_node_id: string | null;
  kind: "card" | "topic";
}
interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  mode?: string;
}

export default function AskClient() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"focused" | "whole-brain">("focused");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setError(null);
    setInput("");
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    const next = [...turns, { role: "user" as const, content: question }];
    setTurns(next);
    setBusy(true);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
    try {
      const res = await fetch("/api/voicemap/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTurns((t) => [...t, { role: "assistant", content: data.answer, sources: data.sources, mode: data.mode }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center gap-2 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Mode:</span>
        {(["focused", "whole-brain"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 font-medium ${
              mode === m
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {m === "focused" ? "Focused" : "Whole brain"}
          </button>
        ))}
        <span className="text-zinc-400 dark:text-zinc-500">
          {mode === "focused" ? "retrieves the most relevant cards" : "reasons over all your wiki pages"}
        </span>
      </div>

      <div className="flex-1 space-y-4">
        {turns.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ask your notes anything — &ldquo;what did I decide about X?&rdquo;, &ldquo;summarize my thinking on Y&rdquo;,
            &ldquo;what keeps coming up?&rdquo; Answers are grounded in your cards, with sources.
          </p>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <WikiMarkdown markdown={t.content} />
                {t.sources && t.sources.length > 0 && (
                  <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                    <div className="mb-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
                      Sources
                    </div>
                    <ol className="space-y-1">
                      {t.sources.map((s) => (
                        <li key={s.n} className="text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="text-zinc-400 dark:text-zinc-500">[{s.n}]</span>{" "}
                          {s.topic_node_id ? (
                            <Link
                              href={`/voicemap/wiki/${encodeURIComponent(s.topic_node_id)}`}
                              className="text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              {s.label}
                            </Link>
                          ) : (
                            s.label
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          )
        )}
        {busy && <div className="text-sm text-zinc-400 dark:text-zinc-500">Thinking…</div>}
        {error && <div className="text-sm text-red-600 dark:text-red-400">Error: {error}</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={ask} className="sticky bottom-0 mt-4 flex gap-2 bg-gradient-to-t from-white pt-3 pb-2 dark:from-zinc-950">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          placeholder="Ask your second brain…"
          className="flex-1 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
