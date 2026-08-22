import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MissingIntrospectionError,
  buildSearchFilter,
  defaultSort,
  loadSchema,
  primaryKeyColumns,
  truncateRow,
} from "@/lib/dbBrowser";

// A page of rows from one table. Read-only: no insert/update/delete lives here,
// and the table and sort column are both checked against the real schema rather
// than passed through, so a crafted query can't reach anything the browser
// wouldn't already list.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const tableName = params.get("table")?.trim() ?? "";
  if (!tableName) {
    return NextResponse.json({ error: "table is required" }, { status: 400 });
  }

  let tables;
  try {
    tables = await loadSchema();
  } catch (err) {
    if (err instanceof MissingIntrospectionError) {
      return NextResponse.json({ error: err.message, setupRequired: true }, { status: 501 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load schema" },
      { status: 500 }
    );
  }

  const table = tables.find((t) => t.name === tableName);
  if (!table) {
    return NextResponse.json({ error: `Unknown table "${tableName}"` }, { status: 404 });
  }

  // Drawer mode: one row, addressed by primary key, with nothing truncated.
  if (params.get("full") === "1") {
    const pks = primaryKeyColumns(table);
    if (!pks.length) {
      return NextResponse.json(
        { error: `"${tableName}" has no primary key, so a single row can't be addressed` },
        { status: 400 }
      );
    }

    let pk: Record<string, unknown>;
    try {
      pk = JSON.parse(params.get("pk") ?? "{}") as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "pk must be a JSON object" }, { status: 400 });
    }

    let single = supabase.from(tableName).select("*");
    for (const col of pks) {
      const value = pk[col.name];
      if (value === undefined || value === null) {
        return NextResponse.json({ error: `pk.${col.name} is required` }, { status: 400 });
      }
      single = single.eq(col.name, value);
    }

    const { data, error } = await single.limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data ?? null });
  }

  const pageSize = clamp(Number(params.get("pageSize")) || DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = Math.max(0, Number(params.get("page")) || 0);

  const requestedSort = params.get("sort");
  const sortColumn = table.columns.find((c) => c.name === requestedSort);
  const sort = sortColumn
    ? { column: sortColumn.name, ascending: params.get("dir") !== "desc" }
    : defaultSort(table);

  const term = params.get("q")?.trim() ?? "";
  const searchFilter = term ? buildSearchFilter(table.columns, term) : null;

  let query = supabase.from(tableName).select("*", { count: "exact" });
  if (searchFilter) query = query.or(searchFilter);
  if (sort) {
    query = query.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
    // Sorting on a non-unique column leaves ties in an arbitrary order, which
    // makes rows appear to shuffle between pages — break them on the key.
    const pk = primaryKeyColumns(table);
    if (pk.length === 1 && pk[0].name !== sort.column) {
      query = query.order(pk[0].name, { ascending: true });
    }
  }

  const from = page * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: (data ?? []).map(truncateRow),
    total: count ?? 0,
    page,
    pageSize,
    sort,
    // Tells the UI when a search box would silently do nothing (a table with no
    // text column, or a term that can't match its uuid/number columns).
    searchable: !term || searchFilter !== null,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
