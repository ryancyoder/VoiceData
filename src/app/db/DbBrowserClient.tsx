"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowseRow, TableMeta } from "@/lib/dbBrowserTypes";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/dbBrowserTypes";
import RowDrawer from "./RowDrawer";
import { formatCell, formatCount, shortType } from "./format";

type Sort = { column: string; ascending: boolean };

export default function DbBrowserClient() {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");

  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [activeSort, setActiveSort] = useState<Sort | null>(null);
  const [searchable, setSearchable] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortOverride, setSortOverride] = useState<Sort | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [drawerRow, setDrawerRow] = useState<BrowseRow | null>(null);
  // Bumped on every open so the drawer remounts per row (see its key below).
  const [drawerSeq, setDrawerSeq] = useState(0);

  // Guards against a slow response for a table you've already navigated away
  // from overwriting the grid.
  const requestId = useRef(0);

  const selected = useMemo(
    () => tables.find((t) => t.name === selectedName) ?? null,
    [tables, selectedName]
  );

  const loadSchema = useCallback(async (refresh = false) => {
    setSchemaLoading(true);
    try {
      const res = await fetch(`/api/db/tables${refresh ? "?refresh=1" : ""}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setTables(body.tables as TableMeta[]);
      setSchemaError(null);
      return body.tables as TableMeta[];
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : "Failed to load the schema");
      return [];
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/db/counts");
      const body = await res.json();
      if (res.ok) setCounts(body.counts as Record<string, number>);
    } catch {
      // Counts are decoration — the list is perfectly usable without them.
    }
  }, []);

  // First load: schema, then counts, then whatever table the URL asked for.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadSchema();
      if (cancelled) return;
      void loadCounts();
      const wanted = new URLSearchParams(window.location.search).get("table");
      if (wanted && loaded.some((t) => t.name === wanted)) setSelectedName(wanted);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSchema, loadCounts]);

  // Keep the URL shareable without pulling in the router's typed-route plumbing.
  useEffect(() => {
    if (!selectedName) return;
    const url = `${window.location.pathname}?table=${encodeURIComponent(selectedName)}`;
    window.history.replaceState(null, "", url);
  }, [selectedName]);

  // Debounce the search box so each keystroke isn't a query.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const fetchRows = useCallback(async () => {
    if (!selectedName) return;
    const id = ++requestId.current;
    setRowsLoading(true);
    setRowsError(null);
    try {
      const params = new URLSearchParams({
        table: selectedName,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search) params.set("q", search);
      if (sortOverride) {
        params.set("sort", sortOverride.column);
        params.set("dir", sortOverride.ascending ? "asc" : "desc");
      }
      const res = await fetch(`/api/db/rows?${params}`);
      const body = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setRows(body.rows as BrowseRow[]);
      setTotal(body.total as number);
      setActiveSort((body.sort as Sort | null) ?? null);
      setSearchable(body.searchable !== false);
    } catch (err) {
      if (id !== requestId.current) return;
      setRows([]);
      setTotal(0);
      setRowsError(err instanceof Error ? err.message : "Failed to load rows");
    } finally {
      if (id === requestId.current) setRowsLoading(false);
    }
  }, [selectedName, page, pageSize, search, sortOverride]);

  useEffect(() => {
    void (async () => {
      await fetchRows();
    })();
  }, [fetchRows]);

  function selectTable(name: string) {
    if (name === selectedName) return;
    setSelectedName(name);
    setPage(0);
    setSortOverride(null);
    setSearchInput("");
    setSearch("");
    setRows([]);
    setTotal(0);
    setDrawerRow(null);
  }

  function toggleSort(column: string) {
    setSortOverride((prev) => {
      const current = prev ?? activeSort;
      if (current?.column === column) return { column, ascending: !current.ascending };
      return { column, ascending: true };
    });
    setPage(0);
  }

  const visibleTables = useMemo(() => {
    const needle = tableFilter.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tables, tableFilter]);

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const firstRowNumber = total === 0 ? 0 : page * pageSize + 1;
  const lastRowNumber = Math.min(total, page * pageSize + rows.length);

  if (schemaError) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-16">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Database</h1>
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm whitespace-pre-line text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {schemaError}
        </p>
        <button
          type="button"
          onClick={() => void loadSchema(true)}
          className="mt-4 rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* Table list */}
      <aside className="flex min-h-0 shrink-0 flex-col border-b border-zinc-200 md:w-72 md:border-r md:border-b-0 dark:border-zinc-800">
        <div className="flex items-center gap-2 px-4 py-3">
          <input
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="Filter tables…"
            className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={() => {
              void loadSchema(true);
              void loadCounts();
              void fetchRows();
            }}
            title="Reload schema and rows"
            className="shrink-0 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto px-2 pb-3 md:max-h-none md:min-h-0 md:flex-1">
          {schemaLoading && tables.length === 0 && (
            <p className="px-2 py-3 text-sm text-zinc-500 dark:text-zinc-400">Loading tables…</p>
          )}
          {!schemaLoading && visibleTables.length === 0 && (
            <p className="px-2 py-3 text-sm text-zinc-500 dark:text-zinc-400">No matching tables.</p>
          )}
          <ul>
            {visibleTables.map((table) => {
              const active = table.name === selectedName;
              const count = counts[table.name];
              return (
                <li key={table.name}>
                  <button
                    type="button"
                    onClick={() => selectTable(table.name)}
                    className={`flex w-full items-baseline justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                      active
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="truncate font-mono text-[13px]">{table.name}</span>
                    <span
                      className={`shrink-0 text-[11px] tabular-nums ${
                        active ? "opacity-70" : "text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {table.kind === "table" ? (count === undefined ? "" : formatCount(count)) : "view"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* Rows */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Pick a table on the left to browse its rows.
            </p>
          </div>
        ) : (
          <>
            <header className="border-b border-zinc-200 px-4 py-3 sm:px-6 dark:border-zinc-800">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-mono text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {selected.name}
                </h1>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatCount(total)} row{total === 1 ? "" : "s"}
                  {search ? " matching" : ""} · {selected.columns.length} columns
                  {selected.kind !== "table" ? ` · ${selected.kind.replace("_", " ")}` : ""}
                </span>
              </div>
              {selected.comment && (
                <p className="mt-1 max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">
                  {selected.comment}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={`Search ${selected.name}…`}
                  className="w-64 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size} / page
                    </option>
                  ))}
                </select>
                {rowsLoading && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">Loading…</span>
                )}
              </div>
              {!searchable && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Nothing in this table can be compared to “{search}” — search covers text columns,
                  plus uuid and number columns on an exact match.
                </p>
              )}
            </header>

            {rowsError ? (
              <p className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:m-6 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {rowsError}
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      {selected.columns.map((col) => {
                        const sorted = activeSort?.column === col.name;
                        return (
                          <th
                            key={col.name}
                            scope="col"
                            className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left align-bottom dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            <button
                              type="button"
                              onClick={() => toggleSort(col.name)}
                              className="flex max-w-64 flex-col items-start gap-0.5"
                              title={col.comment ?? undefined}
                            >
                              <span className="flex items-center gap-1 font-medium whitespace-nowrap text-zinc-700 dark:text-zinc-200">
                                {col.name}
                                {col.is_primary_key && (
                                  <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                    pk
                                  </span>
                                )}
                                {sorted && (
                                  <span className="text-zinc-400">
                                    {activeSort?.ascending ? "↑" : "↓"}
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-[10px] font-normal whitespace-nowrap text-zinc-400 dark:text-zinc-500">
                                {shortType(col.type)}
                              </span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={rowKey(selected, row, index)}
                        onClick={() => {
                          setDrawerRow(row);
                          setDrawerSeq((n) => n + 1);
                        }}
                        className="cursor-pointer even:bg-zinc-50/60 hover:bg-blue-50 dark:even:bg-zinc-900/40 dark:hover:bg-blue-950/30"
                      >
                        {selected.columns.map((col) => {
                          const cell = formatCell(row[col.name]);
                          const cut = row.__truncated?.includes(col.name);
                          return (
                            <td
                              key={col.name}
                              className={`max-w-72 truncate border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800/70 ${
                                cell.muted ? "text-zinc-400 italic dark:text-zinc-600" : "text-zinc-800 dark:text-zinc-200"
                              } ${cell.mono ? "font-mono text-xs" : ""}`}
                              title={cell.text}
                            >
                              {cell.text}
                              {cut && <span className="text-amber-500"> …</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!rowsLoading && rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={selected.columns.length}
                          className="px-3 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                        >
                          {search ? `No rows match “${search}”.` : "This table is empty."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 text-xs text-zinc-500 sm:px-6 dark:border-zinc-800 dark:text-zinc-400">
              <span className="tabular-nums">
                {total === 0
                  ? "No rows"
                  : `${formatCount(firstRowNumber)}–${formatCount(lastRowNumber)} of ${formatCount(total)}`}
              </span>
              <div className="flex items-center gap-1.5">
                <PageButton label="First" disabled={page === 0} onClick={() => setPage(0)} />
                <PageButton
                  label="Prev"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                />
                <span className="px-1 tabular-nums">
                  Page {page + 1} of {lastPage + 1}
                </span>
                <PageButton
                  label="Next"
                  disabled={page >= lastPage}
                  onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                />
                <PageButton
                  label="Last"
                  disabled={page >= lastPage}
                  onClick={() => setPage(lastPage)}
                />
              </div>
            </footer>
          </>
        )}
      </section>

      {selected && drawerRow && (
        <RowDrawer
          // Remounting per row keeps the drawer's own state (loaded full
          // values, errors) from leaking into the next row you open.
          key={drawerSeq}
          table={selected}
          row={drawerRow}
          onClose={() => setDrawerRow(null)}
        />
      )}
    </main>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-zinc-200 px-2.5 py-1 font-medium transition-colors enabled:hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:enabled:hover:bg-zinc-800"
    >
      {label}
    </button>
  );
}

/** Prefer the primary key so React keeps rows identified across refetches. */
function rowKey(table: TableMeta, row: BrowseRow, index: number): string {
  const pk = table.columns.filter((c) => c.is_primary_key);
  if (!pk.length) return `row-${index}`;
  return pk.map((c) => String(row[c.name])).join("|");
}
