"use client";

import { useEffect, useState } from "react";
import type { BrowseRow, TableMeta } from "@/lib/dbBrowserTypes";
import { formatFull, shortType } from "./format";

// One row, every column, full values. The grid hands over the truncated copy it
// already has; anything that was cut is refetched on demand (by primary key)
// rather than shipped with every page.
export default function RowDrawer({
  table,
  row,
  onClose,
}: {
  table: TableMeta;
  row: BrowseRow;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(row);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const truncated = row.__truncated ?? [];
  const pkColumns = table.columns.filter((c) => c.is_primary_key);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function loadFullValues() {
    setLoading(true);
    setError(null);
    try {
      const pk: Record<string, unknown> = {};
      for (const col of pkColumns) pk[col.name] = row[col.name];
      const params = new URLSearchParams({
        table: table.name,
        full: "1",
        pk: JSON.stringify(pk),
      });
      const res = await fetch(`/api/db/rows?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      if (!body.row) throw new Error("That row is no longer there.");
      setValues(body.row as Record<string, unknown>);
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the full row");
    } finally {
      setLoading(false);
    }
  }

  async function copyJson() {
    const { __truncated: _omit, ...clean } = values as BrowseRow;
    void _omit;
    try {
      await navigator.clipboard.writeText(JSON.stringify(clean, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close row details"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/30 backdrop-blur-[1px]"
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {table.name}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {pkColumns.length
                ? pkColumns.map((c) => `${c.name}: ${String(row[c.name] ?? "—")}`).join(" · ")
                : "single row"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={copyJson}
              className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {copied ? "Copied" : "Copy JSON"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-2 py-1 text-lg leading-none text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </header>

        {truncated.length > 0 && !expanded && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <span>
              {truncated.length} value{truncated.length === 1 ? " was" : "s were"} shortened for the
              grid.
            </span>
            {pkColumns.length > 0 && (
              <button
                type="button"
                onClick={loadFullValues}
                disabled={loading}
                className="shrink-0 rounded-full bg-amber-900 px-3 py-1 font-medium text-amber-50 transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-amber-200 dark:text-amber-950"
              >
                {loading ? "Loading…" : "Load full values"}
              </button>
            )}
          </div>
        )}

        {error && (
          <p className="border-b border-red-200 bg-red-50 px-5 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-auto px-5 py-4">
          <dl className="space-y-4">
            {table.columns.map((col) => {
              const value = values[col.name];
              const wasCut = truncated.includes(col.name) && !expanded;
              const isNull = value === null || value === undefined;
              return (
                <div key={col.name}>
                  <dt className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      {col.name}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                      {shortType(col.type)}
                      {col.is_primary_key ? " · pk" : ""}
                    </span>
                  </dt>
                  <dd
                    className={`mt-1 max-h-64 overflow-auto rounded-md bg-zinc-50 px-3 py-2 font-mono text-xs whitespace-pre-wrap ${
                      isNull ? "text-zinc-400 italic dark:text-zinc-600" : "text-zinc-800 dark:text-zinc-200"
                    } dark:bg-zinc-900`}
                  >
                    {formatFull(value)}
                    {wasCut && <span className="text-amber-600 dark:text-amber-400"> …truncated</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </aside>
    </div>
  );
}
