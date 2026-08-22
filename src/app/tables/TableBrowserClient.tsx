"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Cell, ColumnInfo, Row, TableInfo } from "@/lib/tableBrowser";
import {
  FILTER_OPS,
  OP_LABELS,
  OP_TITLES,
  VALUELESS_OPS,
  defaultOpFor,
  type ColumnFilter,
  type FilterOp,
} from "@/lib/tableFilters";
import styles from "./tables.module.css";

const PAGE_SIZES = [25, 50, 100, 200];

type RowsResponse = {
  rows?: Row[];
  total?: number;
  searchedColumns?: string[];
  error?: string;
};

type Query = {
  table: string;
  page: number;
  pageSize: number;
  sort: string | null;
  ascending: boolean;
  search: string;
  /** Active filters, already serialised — see `filterKey`. */
  filters: string;
};

/** One column's filter as the UI holds it, before the column name is attached. */
type DraftFilter = { op: FilterOp; value: string };

const NO_FILTERS = "[]";

/** The outcome of one request, tagged with the query that produced it. */
type Settled = {
  query: Query;
  rows: Row[];
  total: number;
  error: string | null;
};

function queryKey(query: Query): string {
  return JSON.stringify(query);
}

/** Numeric columns read better right-aligned. */
function isNumeric(column: ColumnInfo): boolean {
  return column.jsonType === "integer" || column.jsonType === "number";
}

/** One line, for the grid. Detail view keeps the original formatting. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export default function TableBrowserClient({
  tables,
  initialTable,
}: {
  tables: TableInfo[];
  initialTable: string | null;
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<string | null>(
    initialTable && tables.some((t) => t.name === initialTable) ? initialTable : tables[0]?.name ?? null
  );
  const [tableFilter, setTableFilter] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<string | null>(null);
  const [ascending, setAscending] = useState(true);
  const [filters, setFilters] = useState<Record<string, DraftFilter>>({});
  const [appliedFilters, setAppliedFilters] = useState(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  // The last settled request, tagged with the query it answered. Loading and
  // error are derived from comparing that tag with the current query rather
  // than being set up front, which keeps the fetch effect free of the
  // synchronous setState that causes cascading renders.
  const [settled, setSettled] = useState<Settled | null>(null);
  const [detail, setDetail] = useState<{ row: Row; loading: boolean } | null>(null);

  const table = useMemo(() => tables.find((t) => t.name === selected) ?? null, [tables, selected]);

  const visibleTables = useMemo(() => {
    const needle = tableFilter.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tables, tableFilter]);

  // Debounce typing so each keystroke doesn't fire a query.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Keep the selected table in the URL so a view can be linked to or reloaded.
  useEffect(() => {
    if (!selected) return;
    router.replace(`/tables?table=${encodeURIComponent(selected)}`, { scroll: false });
  }, [selected, router]);

  // Only filters that would actually narrow anything: a value-taking operator
  // with an empty box is still being typed, not a filter.
  const filterKey = useMemo(() => {
    const active: ColumnFilter[] = Object.entries(filters)
      .filter(([, f]) => VALUELESS_OPS.includes(f.op) || f.value.trim() !== "")
      .map(([column, f]) => ({ column, op: f.op, value: f.value.trim() }));
    return active.length > 0 ? JSON.stringify(active) : NO_FILTERS;
  }, [filters]);

  const activeFilterCount = useMemo(
    () => (filterKey === NO_FILTERS ? 0 : (JSON.parse(filterKey) as ColumnFilter[]).length),
    [filterKey]
  );

  // Debounced like the search box, so typing a value doesn't fire a request
  // per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      setAppliedFilters(filterKey);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [filterKey]);

  const query = useMemo<Query | null>(
    () =>
      table
        ? {
            table: table.name,
            page,
            pageSize,
            sort,
            ascending,
            search: search.trim(),
            filters: appliedFilters,
          }
        : null,
    [table, page, pageSize, sort, ascending, search, appliedFilters]
  );

  // Track the newest request so a slow earlier one can't overwrite it.
  const requestId = useRef(0);

  useEffect(() => {
    if (!query) return;
    const id = ++requestId.current;
    const controller = new AbortController();

    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
      dir: query.ascending ? "asc" : "desc",
    });
    if (query.sort) params.set("sort", query.sort);
    if (query.search) params.set("q", query.search);
    if (query.filters !== NO_FILTERS) params.set("filters", query.filters);

    fetch(`/api/tables/${encodeURIComponent(query.table)}/rows?${params}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as RowsResponse;
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        return body;
      })
      .then((body) => {
        if (id !== requestId.current) return;
        setSettled({ query, rows: body.rows ?? [], total: body.total ?? 0, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || id !== requestId.current) return;
        setSettled({
          query,
          rows: [],
          total: 0,
          error: err instanceof Error ? err.message : "Failed to load rows",
        });
      });

    return () => controller.abort();
  }, [query]);

  const loading = !!query && (!settled || queryKey(settled.query) !== queryKey(query));
  const error = settled && !loading ? settled.error : null;

  // While a new page of the same table loads, keep the rows already on screen
  // so paging doesn't flash empty; switching tables clears them.
  const showStale = !!settled && !settled.error && settled.query.table === table?.name;
  const rows = showStale ? settled.rows : [];
  const total = showStale ? settled.total : 0;
  const shownPage = showStale ? settled.query.page : page;

  const selectTable = useCallback((name: string) => {
    setSelected(name);
    setPage(1);
    setSort(null);
    setAscending(true);
    setSearchInput("");
    setSearch("");
    setFilters({});
    setAppliedFilters(NO_FILTERS);
    setShowFilters(false);
    setDetail(null);
    setSidebarOpen(false);
  }, []);

  const toggleSort = useCallback(
    (column: string) => {
      if (sort === column) {
        setAscending((prev) => !prev);
      } else {
        setSort(column);
        setAscending(true);
      }
      setPage(1);
    },
    [sort]
  );

  const setFilter = useCallback((column: string, patch: Partial<DraftFilter>, fallback: FilterOp) => {
    setFilters((prev) => {
      const next = { ...prev };
      const current = prev[column] ?? { op: fallback, value: "" };
      const merged = { ...current, ...patch };
      // Drop the entry entirely once it stops filtering anything, so the
      // active-filter count and the request stay honest.
      if (!VALUELESS_OPS.includes(merged.op) && merged.value === "") delete next[column];
      else next[column] = merged;
      return next;
    });
  }, []);

  // Hiding the row clears the filters — leaving invisible ones applied would
  // silently hide rows.
  const toggleFilters = useCallback(() => {
    setShowFilters((open) => {
      if (open) {
        setFilters({});
        setAppliedFilters(NO_FILTERS);
        setPage(1);
      }
      return !open;
    });
  }, []);

  // Open the detail panel. Grid cells are clipped server-side, so when the
  // table has a single-column primary key the full row is re-fetched.
  const openRow = useCallback(
    async (row: Row) => {
      setDetail({ row, loading: false });
      if (!table || table.primaryKey.length !== 1) return;

      const key = row[table.primaryKey[0]];
      if (!key) return;
      const anyTruncated = Object.values(row).some((cell) => cell?.trunc);
      if (!anyTruncated) return;

      setDetail({ row, loading: true });
      try {
        const res = await fetch(
          `/api/tables/${encodeURIComponent(table.name)}/rows?key=${encodeURIComponent(key.t)}`
        );
        const body = (await res.json()) as { row?: Row; error?: string };
        if (res.ok && body.row) setDetail({ row: body.row, loading: false });
        else setDetail({ row, loading: false });
      } catch {
        setDetail({ row, loading: false });
      }
    },
    [table]
  );

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const firstRowNumber = total === 0 ? 0 : (shownPage - 1) * pageSize + 1;
  const lastRowNumber = Math.min(firstRowNumber + rows.length - 1, total);

  return (
    <div className={styles.page} data-fullheight>
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarHead}>
          <h1>Tables</h1>
          <span className={styles.sidebarCount}>{tables.length}</span>
        </div>
        <input
          type="search"
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          placeholder="Filter tables…"
          className={styles.filterInput}
          aria-label="Filter tables"
        />
        <nav className={styles.tableList}>
          {visibleTables.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => selectTable(t.name)}
              aria-current={t.name === selected ? "true" : undefined}
              className={`${styles.tableItem} ${t.name === selected ? styles.tableItemActive : ""}`}
            >
              <span className={styles.tableItemName}>{t.name}</span>
              <span className={styles.tableItemMeta}>
                {t.readOnly && <span className={styles.viewBadge}>view</span>}
                {t.columns.length}
              </span>
            </button>
          ))}
          {visibleTables.length === 0 && <p className={styles.empty}>No tables match “{tableFilter}”.</p>}
        </nav>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close table list"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className={styles.main}>
        {!table ? (
          <p className={styles.empty}>No tables found in this Supabase project.</p>
        ) : (
          <>
            <header className={styles.header}>
              <button
                type="button"
                className={styles.menuButton}
                onClick={() => setSidebarOpen(true)}
                aria-label="Show table list"
              >
                ☰
              </button>
              <div className={styles.headerTitle}>
                <h2>
                  {table.name}
                  {table.readOnly && <span className={styles.viewBadge}>view</span>}
                </h2>
                <p>
                  {table.columns.length} column{table.columns.length === 1 ? "" : "s"}
                  {table.primaryKey.length > 0 && <> · key {table.primaryKey.join(", ")}</>}
                  {!loading && <> · {formatCount(total)} row{total === 1 ? "" : "s"}</>}
                </p>
              </div>
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search text columns…"
                className={styles.searchInput}
                aria-label={`Search ${table.name}`}
              />
              <button
                type="button"
                onClick={toggleFilters}
                aria-pressed={showFilters}
                title="Per-column filters"
                className={`${styles.filterToggle} ${showFilters ? styles.filterToggleOn : ""}`}
              >
                Filters
                {activeFilterCount > 0 && <span className={styles.filterCount}>{activeFilterCount}</span>}
              </button>
            </header>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.gridWrap}>
              <table className={styles.grid}>
                <thead>
                  <tr>
                    <th className={styles.rowNumHead} scope="col">
                      #
                    </th>
                    {table.columns.map((column) => (
                      <th key={column.name} scope="col">
                        <button
                          type="button"
                          onClick={() => toggleSort(column.name)}
                          className={styles.sortButton}
                          title={`${column.type}${column.references ? ` → ${column.references}` : ""}`}
                        >
                          <span className={styles.columnName}>
                            {column.name}
                            {column.isPrimaryKey && <span className={styles.pkDot} title="Primary key" />}
                          </span>
                          <span className={styles.columnType}>{column.type}</span>
                          {sort === column.name && (
                            <span className={styles.sortArrow}>{ascending ? "▲" : "▼"}</span>
                          )}
                        </button>
                        {showFilters && <ColumnFilterCell
                          column={column}
                          draft={filters[column.name]}
                          onChange={setFilter}
                        />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr
                      key={index}
                      onClick={() => openRow(row)}
                      className={styles.row}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openRow(row);
                        }
                      }}
                    >
                      <td className={styles.rowNum}>{firstRowNumber + index}</td>
                      {table.columns.map((column) => (
                        <td
                          key={column.name}
                          className={isNumeric(column) ? styles.numericCell : undefined}
                        >
                          <CellView cell={row[column.name]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {loading && <div className={styles.loading}>Loading…</div>}
              {!loading && rows.length === 0 && !error && (
                <p className={styles.empty}>
                  {search.trim() || activeFilterCount > 0
                    ? "No rows match the current search and filters."
                    : "This table is empty."}
                </p>
              )}
            </div>

            <footer className={styles.footer}>
              <span className={styles.range}>
                {total === 0 ? "0 rows" : `${formatCount(firstRowNumber)}–${formatCount(lastRowNumber)} of ${formatCount(total)}`}
              </span>
              <div className={styles.pager}>
                <label className={styles.pageSize}>
                  Rows
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  Previous
                </button>
                <span className={styles.pageLabel}>
                  {formatCount(page)} / {formatCount(lastPage)}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                  disabled={page >= lastPage}
                >
                  Next
                </button>
              </div>
            </footer>
          </>
        )}
      </main>

      {detail && table && (
        <RowDetail
          table={table}
          row={detail.row}
          loading={detail.loading}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function ColumnFilterCell({
  column,
  draft,
  onChange,
}: {
  column: ColumnInfo;
  draft: DraftFilter | undefined;
  onChange: (column: string, patch: Partial<DraftFilter>, fallback: FilterOp) => void;
}) {
  const fallback = defaultOpFor(column.type);
  const filter = draft ?? { op: fallback, value: "" };
  const valueless = VALUELESS_OPS.includes(filter.op);

  return (
    <div className={styles.filterCell}>
      <select
        value={filter.op}
        onChange={(e) => onChange(column.name, { op: e.target.value as FilterOp }, fallback)}
        title={OP_TITLES[filter.op]}
        aria-label={`Filter ${column.name} by`}
      >
        {FILTER_OPS.map((op) => (
          <option key={op} value={op} title={OP_TITLES[op]}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>
      <input
        value={valueless ? "" : filter.value}
        disabled={valueless}
        onChange={(e) => onChange(column.name, { value: e.target.value }, fallback)}
        placeholder={valueless ? OP_TITLES[filter.op] : "filter"}
        aria-label={`Filter value for ${column.name}`}
      />
    </div>
  );
}

function CellView({ cell }: { cell: Cell | undefined }) {
  if (cell === null || cell === undefined) return <span className={styles.nullValue}>null</span>;
  if (cell.t === "") return <span className={styles.nullValue}>empty</span>;
  return (
    <span className={styles.cellText} title={cell.trunc ? `${formatCount(cell.len ?? 0)} characters` : cell.t}>
      {oneLine(cell.t)}
      {cell.trunc && <span className={styles.ellipsis}>…</span>}
    </span>
  );
}

function RowDetail({
  table,
  row,
  loading,
  onClose,
}: {
  table: TableInfo;
  row: Row;
  loading: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const asJson = useMemo(() => {
    const plain: Record<string, string | null> = {};
    for (const column of table.columns) plain[column.name] = row[column.name]?.t ?? null;
    return JSON.stringify(plain, null, 2);
  }, [table, row]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(asJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked; the values stay selectable on screen.
    }
  }, [asJson]);

  return (
    <>
      <button type="button" className={styles.scrim} aria-label="Close row" onClick={onClose} />
      <aside className={styles.detail} role="dialog" aria-label="Row detail" aria-modal="true">
        <div className={styles.detailHead}>
          <h3>{table.name}</h3>
          <div className={styles.detailActions}>
            <button type="button" onClick={copy}>
              {copied ? "Copied" : "Copy JSON"}
            </button>
            <button type="button" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        {loading && <p className={styles.detailLoading}>Loading full values…</p>}
        <dl className={styles.detailList}>
          {table.columns.map((column) => {
            const cell = row[column.name];
            return (
              <div key={column.name} className={styles.detailField}>
                <dt>
                  {column.name}
                  {column.isPrimaryKey && <span className={styles.pkDot} title="Primary key" />}
                  <span className={styles.columnType}>{column.type}</span>
                  {column.references && (
                    <span className={styles.fkNote}>→ {column.references}</span>
                  )}
                </dt>
                <dd>
                  {cell === null || cell === undefined ? (
                    <span className={styles.nullValue}>null</span>
                  ) : cell.t === "" ? (
                    <span className={styles.nullValue}>empty string</span>
                  ) : (
                    <pre>
                      {cell.t}
                      {cell.trunc ? `\n… ${formatCount((cell.len ?? 0) - cell.t.length)} more characters` : ""}
                    </pre>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </aside>
    </>
  );
}
