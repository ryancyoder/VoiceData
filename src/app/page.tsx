"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { TableSchema } from "@/lib/db";
import MicButton from "@/components/MicButton";
import SchemaPanel from "@/components/SchemaPanel";

interface DisplayTurn {
  role: "user" | "assistant";
  text: string;
}

interface ActivityEntry {
  name: string;
  input: unknown;
  error?: string;
}

type Status = "idle" | "thinking" | "speaking";

export default function Home() {
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [schema, setSchema] = useState<TableSchema[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const rawMessages = useRef<MessageParam[]>([]);

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setStatus("speaking");
    utterance.onend = () => setStatus("idle");
    utterance.onerror = () => setStatus("idle");
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || status !== "idle") return;
    setError(null);
    setTurns((t) => [...t, { role: "user", text }]);
    rawMessages.current = [...rawMessages.current, { role: "user", content: text }];
    setStatus("thinking");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: rawMessages.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");

      rawMessages.current = data.messages;
      setSchema(data.schema);
      setTurns((t) => [...t, { role: "assistant", text: data.reply }]);
      setActivity((a) => [
        ...data.toolCalls.map((c: ActivityEntry) => ({
          name: c.name,
          input: c.input,
          error: c.error,
        })),
        ...a,
      ]);
      speak(data.reply || "Done.");
      if (!data.reply) setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus("idle");
    }
  }

  function handleSubmitDraft(e: React.FormEvent) {
    e.preventDefault();
    const text = draft;
    setDraft("");
    sendMessage(text);
  }

  const busy = status !== "idle";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            VoiceData
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Talk to build a database on the fly.
          </p>
        </div>
        <Link
          href="/sales-board"
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Sales Board →
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6 sm:flex-row">
        <section className="flex flex-1 flex-col gap-4">
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            {turns.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Press the mic and describe the data you want to track — e.g.
                “Add a book to my reading list called Dune by Frank Herbert.”
              </p>
            )}
            {turns.map((turn, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  turn.role === "user"
                    ? "self-end bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                    : "self-start bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {turn.text}
              </div>
            ))}
            {status === "thinking" && (
              <div className="self-start text-sm text-zinc-400">Thinking…</div>
            )}
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <MicButton
              disabled={busy}
              onTranscript={(text) => sendMessage(text)}
              onError={(msg) => setError(msg)}
            />
            <form onSubmit={handleSubmitDraft} className="flex flex-1 gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
                placeholder="…or type instead"
                className="flex-1 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
              >
                Send
              </button>
            </form>
          </div>
        </section>

        <aside className="flex w-full flex-col gap-4 sm:w-80">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Database
            </h2>
            <SchemaPanel tables={schema} />
          </div>

          {activity.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Activity
              </h2>
              <ul className="flex flex-col gap-1">
                {activity.slice(0, 20).map((entry, i) => (
                  <li
                    key={i}
                    className={`rounded-md px-2 py-1 font-mono text-xs ${
                      entry.error
                        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                    }`}
                  >
                    {entry.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
