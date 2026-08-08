"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface EstimateSummary {
  id: string;
  dealId: number | null;
  projectName: string;
  clientName: string;
  date: string | null;
  total: number | null;
  updatedAt: string;
}

function formatCurrency(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function EstimateListClient() {
  const router = useRouter();
  const [estimates, setEstimates] = useState<EstimateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/estimator/estimates")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load estimates"))))
      .then((data) => {
        setEstimates(data.estimates ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleNew() {
    setCreating(true);
    try {
      const res = await fetch("/api/estimator/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error("create failed");
      const { id } = await res.json();
      router.push(`/estimator/${id}`);
    } catch {
      setError("Could not create a new estimate.");
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this estimate? This cannot be undone.")) return;
    setEstimates((prev) => prev.filter((e) => e.id !== id));
    try {
      const res = await fetch(`/api/estimator/estimates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setError("Could not delete that estimate.");
      load();
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Estimates</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Landscape job estimates.</p>
        </div>
        <button
          onClick={handleNew}
          disabled={creating}
          className="flex items-center gap-2 rounded-full bg-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-60"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {creating ? "Creating…" : "New Estimate"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-zinc-400">Loading estimates…</p>
      ) : estimates.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No estimates yet.</p>
          <button onClick={handleNew} disabled={creating} className="mt-3 text-sm font-medium text-green-700 hover:underline dark:text-green-500">
            Create your first estimate
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {estimates.map((e) => (
            <li key={e.id} className="group flex items-center gap-4 bg-white px-4 py-3 transition-colors hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
              <Link href={`/estimator/${e.id}`} className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                    {e.projectName?.trim() || "Untitled estimate"}
                  </span>
                  {e.dealId != null && (
                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                      Linked to deal
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
                  {[e.clientName?.trim(), formatDate(e.date)].filter(Boolean).join(" · ") || "No client"}
                </div>
              </Link>
              <div className="shrink-0 text-right">
                <div className="font-semibold text-zinc-900 dark:text-zinc-50">{formatCurrency(e.total)}</div>
                <div className="text-xs text-zinc-400">Updated {formatDate(e.updatedAt)}</div>
              </div>
              <button
                onClick={() => handleDelete(e.id)}
                className="shrink-0 rounded-lg p-2 text-zinc-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950"
                title="Delete estimate"
                aria-label="Delete estimate"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
