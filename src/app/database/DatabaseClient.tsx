"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnMeta, TableMeta } from "@/lib/dbBrowser";
import {
  FILTER_OPERATORS,
  VALUELESS_OPERATORS,
  type FilterOperator,
} from "@/lib/dbBrowserOps";

type Row = Record<string, unknown>;

interface QueryResult {
  /** The serialized query this page of rows answers — see `queryKey` below. */
  key: string;
  rows: Row[];
  count: number;
  notice: string | null;
  error: string | null;
}

const PAGE_SIZES = [25, 50, 100, 200];

// ─── value formatting ────────────────────────────────────────────────────────

/** The full value as text — what the detail panel and the CSV export use. */
function fullText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/** A single grid cell: one line, clipped, with the whole value on hover. */
function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-zinc-300 italic dark:text-zinc-600">null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className={value ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}>
        {String(value)}
      </span>
    );
  }
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return (
    <span title={text.length > 80 ? text : undefined}>
      {text.length > 160 ? `${text.slice(0, 160)}…` : text}
    </span>
  );
}

function csvCell(value: unknown): string {
  const text = fullText(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function DatabaseClient({
  initialTables,
  loadError,
}: {
  initialTables: TableMeta[];
  loadError: string | null;
}) {
  const [tables, setTables] = useState<TableMeta[]>(initialTables);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [reloadingSchema, setReloadingSchema] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(
    initialTables[0]?.name ?? null
  );

  // One page of results, tagged with the query that produced it. Comparing that
  // tag to the current query gives us both the loading flag and the guard
  // against a slow response landing on top of a newer one — no extra state to
  // keep in sync, and nothing set synchronously from the effect.
  const [result, setResult] = useState<QueryResult | null>(null);

  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterCol, setFilterCol] = useState("");
  const [filterOp, setFilterOp] = useState<FilterOperator>("eq");
  const [filterVal, setFilterVal] = useState("");
  const [filter, setFilter] = useState<{
    col: string;
    op: FilterOperator;
    val: string;
  } | null>(null);

  const [detail, setDetail] = useState<Row | null>(null);
  // Bumped by Refresh: it changes the query tag, so the same query re-runs.
  const [nonce, setNonce] = useState(0);

  const meta = useMemo(
    () => tables.find((t) => t.name === selected) ?? null,
    [tables, selected]
  );

  const visibleTables = useMemo(() => {
    const needle = tableFilter.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tables, tableFilter]);

  // Debounce the search box so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const queryKey = useMemo(
    () =>
      JSON.stringify([selected, limit, offset, sort, dir, search, filter, nonce]),
    [selected, limit, offset, sort, dir, search, filter, nonce]
  );

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();

    const params = new URLSearchParams({
      table: selected,
      limit: String(limit),
      offset: String(offset),
    });
    if (sort) {
      params.set("sort", sort);
      params.set("dir", dir);
    }
    if (search) params.set("q", search);
    if (filter) {
      params.set("filterCol", filter.col);
      params.set("filterOp", filter.op);
      params.set("filterVal", filter.val);
    }

    fetch(`/api/database/rows?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        // A response that arrived just as the query changed is already stale.
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(data.error || "Failed to load rows");
        setResult({
          key: queryKey,
          rows: data.rows,
          count: data.count,
          notice: data.notice ?? null,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: queryKey,
          rows: [],
          count: 0,
          notice: null,
          error: err instanceof Error ? err.message : "Failed to load rows",
        });
      });

    return () => controller.abort();
  }, [queryKey, selected, limit, offset, sort, dir, search, filter]);

  // Memoized so an empty result doesn't hand `columns` a fresh array each render.
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const count = result?.count ?? 0;
  const error = result?.error ?? null;
  const notice = result?.notice ?? null;
  const loading = result?.key !== queryKey;

  // Columns come from the schema; if a view reports none, fall back to the
  // union of keys actually present in the rows so the grid still renders.
  const columns: ColumnMeta[] = useMemo(() => {
    if (meta?.columns.length) return meta.columns;
    const names = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row)) names.add(key);
    return [...names].map((name) => ({
      name,
      type: "unknown",
      isPrimaryKey: false,
      foreignKey: null,
      description: null,
    }));
  }, [meta, rows]);

  // Switching tables resets everything that was scoped to the old one.
  function selectTable(name: string | null) {
    setSelected(name);
    setOffset(0);
    setSort(null);
    setDir("asc");
    setSearchInput("");
    setSearch("");
    setFilterCol("");
    setFilterOp("eq");
    setFilterVal("");
    setFilter(null);
    setResult(null);
    setDetail(null);
  }

  // Re-introspects the schema. The server caches the spec for a minute, so a
  // table added just now won't show up (and the rows route would reject it)
  // until this forces a fresh read.
  async function reloadSchema() {
    setReloadingSchema(true);
    setSchemaError(null);
    try {
      const res = await fetch("/api/database/tables");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reload schema");
      setTables(data.tables);
      if (!data.tables.some((t: TableMeta) => t.name === selected)) {
        selectTable(data.tables[0]?.name ?? null);
      }
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : "Failed to reload schema");
    } finally {
      setReloadingSchema(false);
    }
  }

  function toggleSort(col: string) {
    setOffset(0);
    if (sort === col) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(col);
      setDir("asc");
    }
  }

  function applyFilter() {
    setOffset(0);
    setFilter(
      filterCol ? { col: filterCol, op: filterOp, val: filterVal } : null
    );
  }

  function clearFilter() {
    setOffset(0);
    setFilterCol("");
    setFilterOp("eq");
    setFilterVal("");
    setFilter(null);
  }

  function downloadCsv() {
    if (!selected || !rows.length) return;
    const header = columns.map((c) => csvCell(c.name)).join(",");
    const body = rows
      .map((row) => columns.map((c) => csvCell(row[c.name])).join(","))
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.replace(/\W+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const valueless = VALUELESS_OPERATORS.includes(filterOp);
  const from = count === 0 ? 0 : offset + 1;
  const to = Math.min(offset + rows.length, count);

  return (
    <div className="flex min-h-0 flex-1 bg-zinc-50 font-sans dark:bg-black">
      {/* ── table list ─────────────────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Database
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              {tables.length} table{tables.length === 1 ? "" : "s"} · read-only
            </span>
            <button
              type="button"
              onClick={reloadSchema}
              disabled={reloadingSchema}
              title="Re-read the schema"
              className="rounded px-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              {reloadingSchema ? "…" : "↻"}
            </button>
          </p>
          {schemaError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{schemaError}</p>
          )}
          <input
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="Find a table…"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visibleTables.map((t) => {
            const active = t.name === selected;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => selectTable(t.name)}
                className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
                title={`${t.name} — ${t.columns.length} columns`}
              >
                {t.name}
              </button>
            );
          })}
          {visibleTables.length === 0 && (
            <p className="px-2 py-3 text-sm text-zinc-400">No matching tables.</p>
          )}
        </div>
      </aside>

      {/* ── rows ───────────────────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        {loadError ? (
          <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <p className="font-medium">Couldn&apos;t read the schema</p>
            <p className="mt-1">{loadError}</p>
          </div>
        ) : !selected ? (
          <p className="m-6 text-sm text-zinc-500">Pick a table to browse.</p>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="mr-auto truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {selected}
                <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                  {loading ? "loading…" : `${count.toLocaleString()} rows`}
                </span>
              </h2>
              <input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setOffset(0);
                }}
                placeholder="Search text columns…"
                className="w-56 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => setNonce((n) => n + 1)}
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={!rows.length}
                title="Download the rows on this page as CSV"
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                CSV
              </button>
            </header>

            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
              <select
                value={filterCol}
                onChange={(e) => setFilterCol(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="">Filter column…</option>
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={filterOp}
                onChange={(e) => setFilterOp(e.target.value as FilterOperator)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {FILTER_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                value={filterVal}
                onChange={(e) => setFilterVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilter();
                }}
                disabled={valueless}
                placeholder="value"
                className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm placeholder:text-zinc-400 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={applyFilter}
                disabled={!filterCol}
                className="rounded-md bg-zinc-900 px-2.5 py-1 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Apply
              </button>
              {filter && (
                <button
                  type="button"
                  onClick={clearFilter}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Clear
                </button>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                Rows
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setOffset(0);
                  }}
                  className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error && (
              <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}
            {notice && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                {notice}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-max min-w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(228_228_231)] dark:bg-zinc-950 dark:shadow-[0_1px_0_0_rgb(39_39_42)]">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.name}
                        scope="col"
                        className="px-3 py-2 font-medium whitespace-nowrap"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.name)}
                          title={[
                            c.type,
                            c.isPrimaryKey ? "primary key" : null,
                            c.foreignKey
                              ? `→ ${c.foreignKey.table}.${c.foreignKey.column}`
                              : null,
                            c.description,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          className="flex items-center gap-1 text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                        >
                          {c.isPrimaryKey && (
                            <span className="text-amber-500" aria-label="primary key">
                              ★
                            </span>
                          )}
                          {c.name}
                          <span className="text-xs font-normal text-zinc-400">
                            {sort === c.name ? (dir === "asc" ? "↑" : "↓") : ""}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      onClick={() => setDetail(row)}
                      className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-100 dark:border-zinc-900 dark:hover:bg-zinc-900"
                    >
                      {columns.map((c) => (
                        <td
                          key={c.name}
                          className="max-w-md truncate px-3 py-1.5 align-top text-zinc-700 dark:text-zinc-300"
                        >
                          <Cell value={row[c.name]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && rows.length === 0 && !error && (
                <p className="px-4 py-6 text-sm text-zinc-500">No rows.</p>
              )}
            </div>

            <footer className="flex items-center gap-3 border-t border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              {/* Left-aligned on purpose: the app's floating action buttons sit
                  over the bottom-right corner of every page. */}
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0 || loading}
                className="rounded-md border border-zinc-300 px-2.5 py-1 disabled:opacity-40 dark:border-zinc-700"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= count || loading}
                className="rounded-md border border-zinc-300 px-2.5 py-1 disabled:opacity-40 dark:border-zinc-700"
              >
                Next
              </button>
              <span>
                {from.toLocaleString()}–{to.toLocaleString()} of{" "}
                {count.toLocaleString()}
              </span>
            </footer>
          </>
        )}
      </main>

      {/* ── row detail ─────────────────────────────────────────────────── */}
      {detail && (
        <aside className="flex w-96 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <h3 className="mr-auto text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Row
            </h3>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
          {/* Extra right padding keeps long values out from under the app's
              floating action buttons. */}
          <dl className="min-h-0 flex-1 overflow-y-auto p-4 pr-14 text-sm">
            {columns.map((c) => (
              <div key={c.name} className="mb-3">
                <dt className="text-xs font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
                  {c.name}
                  <span className="ml-1.5 font-normal text-zinc-400 dark:text-zinc-600">
                    {c.type}
                  </span>
                </dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                  {detail[c.name] === null || detail[c.name] === undefined ? (
                    <span className="text-zinc-300 italic dark:text-zinc-600">null</span>
                  ) : (
                    <pre className="font-sans whitespace-pre-wrap break-words">
                      {fullText(detail[c.name])}
                    </pre>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </div>
  );
}
