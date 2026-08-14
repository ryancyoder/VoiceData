"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Populates node embeddings by calling /api/voicemap/embed repeatedly until the
// whole corpus is indexed (the endpoint is bounded per call and reports how many
// cards remain). Only re-embeds cards whose text changed, so re-running is cheap.
export default function ReindexCards({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg("Indexing…");
    let total = 0;
    try {
      // Safety-capped loop; each call embeds a bounded batch and returns `remaining`.
      for (let i = 0; i < 200; i++) {
        const res = await fetch("/api/voicemap/embed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        total += data.embedded || 0;
        setMsg(data.remaining ? `Indexed ${total}… (${data.remaining} left)` : null);
        if (!data.remaining) break;
      }
      setMsg(total ? `Indexed ${total} card${total === 1 ? "" : "s"} ✓` : "Already up to date ✓");
      router.refresh();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={
          className ??
          "rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }
      >
        {busy ? "Indexing…" : "Reindex cards"}
      </button>
      {msg && <span className="text-xs text-zinc-500 dark:text-zinc-400">{msg}</span>}
    </span>
  );
}
