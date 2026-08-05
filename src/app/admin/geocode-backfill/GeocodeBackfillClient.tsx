"use client";

import { useRef, useState } from "react";
import Link from "next/link";

interface ProcessedAddress {
  address: string;
  matched: boolean;
  dealsUpdated: number;
}

const BATCH_LIMIT = 5;

export default function GeocodeBackfillClient({ initialRemaining }: { initialRemaining: number }) {
  const [remaining, setRemaining] = useState(initialRemaining);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<ProcessedAddress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  async function runBackfill() {
    setRunning(true);
    setError(null);
    stopRef.current = false;

    try {
      while (!stopRef.current) {
        const res = await fetch(`/api/sales-board/geocode-backfill?limit=${BATCH_LIMIT}`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Backfill request failed");

        setLog((l) => [...l, ...data.processed]);
        setRemaining(data.remaining);

        if (data.remaining === 0 || data.processed.length === 0) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-1 flex-col gap-6 bg-zinc-50 p-6 font-sans dark:bg-black">
      <header>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Geocode backfill</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          One-time utility: geocodes every jobsite address that hasn&apos;t been geocoded yet, so existing
          deals get GPS coordinates for photo/calendar matching.{" "}
          <Link href="/sales-board" className="underline">
            ← Sales Board
          </Link>
        </p>
      </header>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            {`${remaining} address${remaining === 1 ? "" : "es"} left to geocode`}
          </div>
          <div className="flex gap-2">
            {running ? (
              <button
                type="button"
                onClick={() => {
                  stopRef.current = true;
                }}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={runBackfill}
                disabled={remaining === 0}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
              >
                {remaining === 0 ? "All geocoded" : "Run backfill"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Runs ~1 address/second (Nominatim&apos;s rate limit) — leave this tab open until it finishes. Safe to
          stop and resume anytime.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {log.length > 0 && (
        <div className="flex flex-col gap-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {log
            .slice()
            .reverse()
            .map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 font-mono text-xs">
                <span className="truncate text-zinc-600 dark:text-zinc-400">{item.address}</span>
                <span className={item.matched ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                  {item.matched ? `✓ ${item.dealsUpdated} deal${item.dealsUpdated === 1 ? "" : "s"}` : "not found"}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
