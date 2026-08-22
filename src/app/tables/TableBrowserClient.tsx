"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Database,
  Download,
  Filter,
  KeyRound,
  Link2,
  List,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

// Read-only browser for the project's Supabase tables. The schema comes from
// /api/tables (PostgREST's own OpenAPI description) and rows come from
// /api/tables/rows, which does the filtering, sorting, and counting in the
// database. Nothing here writes.

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  references: string | null;
  default: string | null;
  description: string | null;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

type Row = Record<string, unknown>;

type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "is_null"
  | "not_null";

interface ColumnFilter {
  op: FilterOp;
  value: string;
}

const OP_LABELS: Record<FilterOp, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "has",
  startsWith: "a…",
  endsWith: "…z",
  in: "in",
  is_null: "∅",
  not_null: "!∅",
};

const OP_TITLES: Record<FilterOp, string> = {
  eq: "equals",
  neq: "not equal",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  in: "in list (comma separated)",
  is_null: "is null",
  not_null: "is not null",
};

const VALUELESS_OPS: FilterOp[] = ["is_null", "not_null"];

const PAGE_SIZES = [25, 50, 100, 200];

const TEXT_TYPES = new Set(["text", "character varying", "character", "citext", "name"]);

function defaultOp(column: ColumnInfo): FilterOp {
  return TEXT_TYPES.has(column.type) ? "contains" : "eq";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : formatValue(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function TableBrowserClient({ projectHost }: { projectHost: string }) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [sidebarQuery, setSidebarQuery] = useState("");
  // Desktop always shows the table list (md:flex below); on phones it starts
  // closed and this toggles it.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [order, setOrder] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [copied, setCopied] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const requestId = useRef(0);

  const table = useMemo(
    () => tables.find((t) => t.name === selected) ?? null,
    [tables, selected],
  );
  const visibleColumns = useMemo(
    () => (table ? table.columns.filter((c) => !hidden.has(c.name)) : []),
    [table, hidden],
  );

  // Schema, then row counts in the background (one HEAD per table, so it
  // shouldn't hold up the first render).
  const loadTables = useCallback(async (refresh = false) => {
    setLoadingTables(true);
    setTablesError(null);
    try {
      const res = await fetch(`/api/tables${refresh ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setTables(data.tables ?? []);
      return (data.tables ?? []) as TableInfo[];
    } catch (err) {
      setTablesError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setLoadingTables(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const loaded = await loadTables();
      if (!active || loaded.length === 0) return;
      const wanted = new URLSearchParams(window.location.search).get("table");
      setSelected(loaded.some((t) => t.name === wanted) ? wanted : loaded[0].name);
      const res = await fetch("/api/tables/counts").catch(() => null);
      if (!active || !res?.ok) return;
      const data = await res.json();
      if (active) setCounts(data.counts ?? {});
    })();
    return () => {
      active = false;
    };
  }, [loadTables]);

  // Keep the selected table in the URL so a reload (or a shared link) lands in
  // the same place, without a navigation.
  useEffect(() => {
    if (!selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set("table", selected);
    window.history.replaceState(null, "", url);
  }, [selected]);

  // Debounced search and filters. Both change which rows match, so they also
  // send you back to the first page.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Only filters with something to send.
  const activeFilters = useMemo(
    () =>
      Object.entries(filters)
        .filter(
          ([, f]) => VALUELESS_OPS.includes(f.op) || f.value.trim().length > 0,
        )
        .map(([column, f]) => ({ column, op: f.op, value: f.value.trim() })),
    [filters],
  );
  const filterKey = JSON.stringify(activeFilters);
  const [appliedFilterKey, setAppliedFilterKey] = useState("[]");
  useEffect(() => {
    const id = setTimeout(() => {
      setAppliedFilterKey(filterKey);
      setPage(0);
    }, 350);
    return () => clearTimeout(id);
  }, [filterKey]);

  // The one place rows are fetched: any change to the table, page, sort,
  // search, or filters re-runs it, and the refresh button bumps reloadToken.
  // A stale response is dropped by comparing against the latest request id.
  useEffect(() => {
    if (!selected) return;
    const id = ++requestId.current;
    const controller = new AbortController();

    void (async () => {
      // Yield first so the effect body itself doesn't set state synchronously.
      await Promise.resolve();
      if (requestId.current !== id) return;
      setLoadingRows(true);
      setRowsError(null);
      try {
        const params = new URLSearchParams({
          table: selected,
          limit: String(pageSize),
          offset: String(page * pageSize),
        });
        if (order) {
          params.set("order", order.column);
          params.set("dir", order.dir);
        }
        if (search) params.set("search", search);
        if (appliedFilterKey !== "[]") params.set("filters", appliedFilterKey);

        const res = await fetch(`/api/tables/rows?${params}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (requestId.current !== id) return;
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        setRows(data.rows ?? []);
        setRowCount(data.count ?? 0);
      } catch (err) {
        if (requestId.current !== id || controller.signal.aborted) return;
        setRows([]);
        setRowCount(0);
        setRowsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestId.current === id) setLoadingRows(false);
      }
    })();

    return () => controller.abort();
  }, [selected, pageSize, page, order, search, appliedFilterKey, reloadToken]);

  function selectTable(name: string) {
    if (name === selected) return;
    setSelected(name);
    setPage(0);
    setOrder(null);
    setFilters({});
    // Also clear the debounced copy, or the first query against the new table
    // still carries the previous table's filters and comes back 400.
    setAppliedFilterKey("[]");
    setSearchInput("");
    setSearch("");
    setHidden(new Set());
    setDetailRow(null);
    setShowColumnPicker(false);
    setSidebarOpen(false);
  }

  // Follow a foreign key: jump to the referenced table filtered to that row.
  function openReference(reference: string, value: unknown) {
    const dot = reference.lastIndexOf(".");
    const target = reference.slice(0, dot);
    const column = reference.slice(dot + 1);
    if (value === null || value === undefined) return;
    if (!tables.some((t) => t.name === target)) return;
    const filter = { column, op: "eq" as FilterOp, value: String(value) };
    setSelected(target);
    setPage(0);
    setOrder(null);
    setSearchInput("");
    setSearch("");
    setHidden(new Set());
    setDetailRow(null);
    setFilters({ [column]: { op: filter.op, value: filter.value } });
    setAppliedFilterKey(JSON.stringify([filter]));
    setShowFilters(true);
  }

  function toggleSort(column: string) {
    setOrder((current) => {
      if (!current || current.column !== column) return { column, dir: "asc" };
      if (current.dir === "asc") return { column, dir: "desc" };
      return null;
    });
    setPage(0);
  }

  function setFilter(column: string, patch: Partial<ColumnFilter>, fallback: FilterOp) {
    setFilters((current) => {
      const next = { ...current };
      const existing = next[column] ?? { op: fallback, value: "" };
      next[column] = { ...existing, ...patch };
      if (!VALUELESS_OPS.includes(next[column].op) && next[column].value === "") {
        delete next[column];
      }
      return next;
    });
  }

  function exportCsv() {
    if (!table || rows.length === 0) return;
    const cols = visibleColumns.map((c) => c.name);
    const csv = [
      cols.map(csvCell).join(","),
      ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.name.replace(/[^a-z0-9_-]+/gi, "_")}-page-${page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyDetail() {
    if (!detailRow) return;
    await navigator.clipboard.writeText(JSON.stringify(detailRow, null, 2)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDetailRow(null);
        setShowColumnPicker(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebarTables = useMemo(() => {
    const q = sidebarQuery.trim().toLowerCase();
    return q ? tables.filter((t) => t.name.toLowerCase().includes(q)) : tables;
  }, [tables, sidebarQuery]);

  const from = rowCount === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(rowCount, page * pageSize + rows.length);
  const lastPage = Math.max(0, Math.ceil(rowCount / pageSize) - 1);

  return (
    // data-fullheight pins the body to the viewport (see globals.css) so the
    // grid scrolls inside itself, with the toolbar and pager always on screen.
    <div
      data-fullheight
      className="flex min-h-0 flex-1 overflow-hidden text-zinc-900 dark:text-zinc-100"
    >
      {/* Table list */}
      <aside
        className={`${
          sidebarOpen ? "flex" : "hidden"
        } w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:flex dark:border-zinc-800 dark:bg-zinc-900/40`}
      >
        <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Database className="h-4 w-4 text-zinc-400" />
            Tables
            <span className="ml-auto text-xs font-normal text-zinc-400">{tables.length}</span>
          </div>
          {projectHost && (
            <p className="mt-0.5 truncate text-[11px] text-zinc-400" title={projectHost}>
              {projectHost}
            </p>
          )}
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={sidebarQuery}
              onChange={(e) => setSidebarQuery(e.target.value)}
              placeholder="Find a table"
              className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pr-2 pl-7 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {loadingTables && <p className="px-3 py-2 text-xs text-zinc-400">Loading schema…</p>}
          {!loadingTables && sidebarTables.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-400">No tables match.</p>
          )}
          {sidebarTables.map((t) => {
            const count = counts[t.name];
            const active = t.name === selected;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => selectTable(t.name)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="truncate font-mono">{t.name}</span>
                <span
                  className={`ml-auto shrink-0 tabular-nums ${
                    active ? "opacity-70" : "text-zinc-400"
                  }`}
                >
                  {count === undefined ? "" : count === null ? "–" : count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Rows */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-md border border-zinc-200 p-1.5 md:hidden dark:border-zinc-700"
            aria-label="Toggle table list"
          >
            <List className="h-4 w-4" />
          </button>
          <h1 className="truncate font-mono text-sm font-semibold">{selected ?? "—"}</h1>
          {table && (
            <span className="hidden text-xs text-zinc-400 sm:inline">
              {table.columns.length} column{table.columns.length === 1 ? "" : "s"}
            </span>
          )}

          <div className="relative ml-auto min-w-[7.5rem] flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search text columns"
              className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pr-2 pl-7 text-xs outline-none focus:border-zinc-400 sm:w-56 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            title="Per-column filters"
            className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
              showFilters || activeFilters.length > 0
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            {activeFilters.length > 0 ? activeFilters.length : "Filter"}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColumnPicker((v) => !v)}
              title="Show/hide columns"
              className="flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <Columns3 className="h-3.5 w-3.5" />
              {hidden.size > 0 ? `${visibleColumns.length}/${table?.columns.length ?? 0}` : "Columns"}
            </button>
            {showColumnPicker && table && (
              <div className="absolute right-0 z-30 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => setHidden(new Set())}
                  className="w-full rounded px-2 py-1 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Show all
                </button>
                {table.columns.map((c) => (
                  <label
                    key={c.name}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.name)}
                      onChange={() =>
                        setHidden((current) => {
                          const next = new Set(current);
                          if (next.has(c.name)) next.delete(c.name);
                          else next.add(c.name);
                          return next;
                        })
                      }
                    />
                    <span className="truncate font-mono">{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            title="Download this page as CSV"
            className="rounded-md border border-zinc-200 p-1.5 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              void loadTables(true);
              setReloadToken((t) => t + 1);
            }}
            title="Reload schema and rows"
            className="rounded-md border border-zinc-200 p-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingRows ? "animate-spin" : ""}`} />
          </button>
        </div>

        {tablesError && (
          <p className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {tablesError}
          </p>
        )}
        {rowsError && (
          <p className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {rowsError}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {table && (
            <table className="w-max min-w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-900">
                <tr>
                  {visibleColumns.map((c) => {
                    const sorted = order?.column === c.name ? order.dir : null;
                    return (
                      <th
                        key={c.name}
                        className="border-b border-zinc-200 px-2 py-1.5 text-left font-medium whitespace-nowrap dark:border-zinc-800"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.name)}
                          className="flex max-w-[22rem] items-center gap-1"
                          title={[
                            `${c.name} · ${c.type}`,
                            c.isPrimaryKey ? "primary key" : null,
                            c.references ? `→ ${c.references}` : null,
                            c.nullable ? "nullable" : "not null",
                            c.description,
                          ]
                            .filter(Boolean)
                            .join("\n")}
                        >
                          {c.isPrimaryKey && <KeyRound className="h-3 w-3 shrink-0 text-amber-500" />}
                          {c.references && <Link2 className="h-3 w-3 shrink-0 text-sky-500" />}
                          <span className="truncate font-mono">{c.name}</span>
                          <span className="shrink-0 font-normal text-zinc-400">{c.type}</span>
                          {sorted === "asc" && <ArrowUp className="h-3 w-3 shrink-0" />}
                          {sorted === "desc" && <ArrowDown className="h-3 w-3 shrink-0" />}
                        </button>
                      </th>
                    );
                  })}
                </tr>
                {showFilters && (
                  <tr>
                    {visibleColumns.map((c) => {
                      const fallback = defaultOp(c);
                      const f = filters[c.name] ?? { op: fallback, value: "" };
                      return (
                        <th
                          key={c.name}
                          className="border-b border-zinc-200 px-1 py-1 font-normal dark:border-zinc-800"
                        >
                          <div className="flex items-center gap-1">
                            <select
                              value={f.op}
                              onChange={(e) =>
                                setFilter(c.name, { op: e.target.value as FilterOp }, fallback)
                              }
                              title={OP_TITLES[f.op]}
                              className="rounded border border-zinc-200 bg-white px-0.5 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {(Object.keys(OP_LABELS) as FilterOp[]).map((op) => (
                                <option key={op} value={op} title={OP_TITLES[op]}>
                                  {OP_LABELS[op]}
                                </option>
                              ))}
                            </select>
                            <input
                              value={f.value}
                              disabled={VALUELESS_OPS.includes(f.op)}
                              onChange={(e) =>
                                setFilter(c.name, { value: e.target.value }, fallback)
                              }
                              placeholder="filter"
                              className="w-24 min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1.5 py-1 text-[11px] outline-none focus:border-zinc-400 disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
                            />
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => setDetailRow(row)}
                    className="cursor-pointer even:bg-zinc-50 hover:bg-amber-50 dark:even:bg-zinc-900/40 dark:hover:bg-zinc-800"
                  >
                    {visibleColumns.map((c) => {
                      const value = row[c.name];
                      const empty = value === null || value === undefined;
                      const text = formatValue(value);
                      return (
                        <td
                          key={c.name}
                          title={text.length > 60 ? text.slice(0, 2000) : undefined}
                          className={`max-w-[22rem] truncate border-b border-zinc-100 px-2 py-1.5 align-top dark:border-zinc-800/70 ${
                            empty ? "text-zinc-300 italic dark:text-zinc-600" : ""
                          }`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loadingRows && table && rows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-zinc-400">
              No rows{search || activeFilters.length > 0 ? " match this search" : " yet"}.
            </p>
          )}
        </div>

        {/* pr-20 keeps the pager clear of the app's floating action buttons. */}
        <div className="flex items-center gap-3 border-t border-zinc-200 py-2 pr-20 pl-3 text-xs text-zinc-500 dark:border-zinc-800">
          <span className="whitespace-nowrap tabular-nums">
            {loadingRows ? "Loading…" : `${from.toLocaleString()}–${to.toLocaleString()} of ${rowCount.toLocaleString()}`}
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="rounded border border-zinc-200 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} rows
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loadingRows}
              className="rounded border border-zinc-200 p-1 disabled:opacity-40 dark:border-zinc-700"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums">
              {page + 1} / {lastPage + 1}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              disabled={page >= lastPage || loadingRows}
              className="rounded border border-zinc-200 p-1 disabled:opacity-40 dark:border-zinc-700"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Row detail */}
      {detailRow && table && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="font-mono text-sm font-semibold">{table.name}</span>
            <button
              type="button"
              onClick={copyDetail}
              className="ml-auto flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy JSON"}
            </button>
            <button
              type="button"
              onClick={() => setDetailRow(null)}
              className="rounded-md border border-zinc-200 p-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {table.columns.map((c) => {
              const value = detailRow[c.name];
              const empty = value === null || value === undefined;
              const isObject = !empty && typeof value === "object";
              return (
                <div key={c.name} className="border-b border-zinc-100 py-2 dark:border-zinc-800/70">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-xs font-medium">{c.name}</span>
                    <span className="text-[11px] text-zinc-400">{c.type}</span>
                    {c.isPrimaryKey && <KeyRound className="h-3 w-3 text-amber-500" />}
                    {c.references && (
                      <button
                        type="button"
                        onClick={() => openReference(c.references!, value)}
                        disabled={empty}
                        title={`Open ${c.references} for this value`}
                        className="text-[11px] text-sky-500 hover:underline disabled:text-zinc-400 disabled:no-underline"
                      >
                        → {c.references}
                      </button>
                    )}
                  </div>
                  <pre
                    className={`mt-1 font-mono text-xs break-words whitespace-pre-wrap ${
                      empty ? "text-zinc-300 italic dark:text-zinc-600" : ""
                    }`}
                  >
                    {empty ? "null" : isObject ? JSON.stringify(value, null, 2) : String(value)}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
