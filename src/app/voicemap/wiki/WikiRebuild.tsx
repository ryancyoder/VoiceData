"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Rebuild button — POSTs to the synthesis route, then refreshes the server
// component so the new content/version shows. Same-origin, so the app's
// password-gate cookie authenticates it.
export default function WikiRebuild({
  sessionId,
  topicNodeId,
  all,
  label,
  className,
}: {
  sessionId: string;
  topicNodeId?: string;
  all?: boolean;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/voicemap/wiki/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? { session_id: sessionId, all: true } : { session_id: sessionId, topic_node_id: topicNodeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
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
          "rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        }
      >
        {busy ? "Rebuilding…" : label ?? "Rebuild"}
      </button>
      {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
    </span>
  );
}
