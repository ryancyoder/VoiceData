import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { loadTables, isSearchableType, type ColumnMeta } from "@/lib/dbBrowser";
import { isFilterOperator } from "@/lib/dbBrowserOps";

// One page of rows from one table, for the browser at /database. Read-only:
// there is no POST/PATCH/DELETE here on purpose — this is a viewer, and edits
// belong in the app screens that own the data.
//
// Everything the caller names (table, sort column, filter column, operator) is
// checked against the introspected schema before it reaches PostgREST, so a
// crafted query can't reach past what the schema already exposes.

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Column names safe to drop into PostgREST's `or=(...)` grammar unquoted.
// Anything with a space or punctuation is skipped by the free-text search
// rather than guessing at its quoting rules.
const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Inside a PostgREST filter value, double quotes and backslashes are the two
// characters that need escaping; quoting the whole value then keeps commas and
// parentheses in the search text from being read as filter syntax.
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function searchClause(columns: ColumnMeta[], term: string): string | null {
  const escaped = quoteFilterValue(`%${term}%`);
  const parts = columns
    .filter((c) => isSearchableType(c.type) && PLAIN_IDENT.test(c.name))
    .map((c) => `${c.name}.ilike.${escaped}`);
  return parts.length ? parts.join(",") : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const table = searchParams.get("table");
  if (!table) {
    return NextResponse.json({ error: "table is required" }, { status: 400 });
  }

  let columns: ColumnMeta[];
  try {
    const tables = await loadTables();
    const meta = tables.find((t) => t.name === table);
    if (!meta) {
      return NextResponse.json({ error: `Unknown table: ${table}` }, { status: 404 });
    }
    columns = meta.columns;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load schema" },
      { status: 500 }
    );
  }

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  let query = supabase.from(table).select("*", { count: "exact" });

  // Column filter — the operator comes from a fixed list and the column must
  // exist on this table.
  const filterCol = searchParams.get("filterCol");
  const filterOp = searchParams.get("filterOp");
  const filterVal = searchParams.get("filterVal") ?? "";
  if (filterCol && filterOp) {
    if (!columns.some((c) => c.name === filterCol)) {
      return NextResponse.json(
        { error: `Unknown column: ${filterCol}` },
        { status: 400 }
      );
    }
    if (!isFilterOperator(filterOp)) {
      return NextResponse.json(
        { error: `Unsupported operator: ${filterOp}` },
        { status: 400 }
      );
    }
    if (filterOp === "isnull") {
      query = query.is(filterCol, null);
    } else if (filterOp === "notnull") {
      query = query.not(filterCol, "is", null);
    } else if (filterOp === "ilike") {
      query = query.ilike(filterCol, `%${filterVal}%`);
    } else if (filterVal !== "") {
      query = query.filter(filterCol, filterOp, filterVal);
    }
  }

  // Free-text search across this table's text columns.
  const q = searchParams.get("q")?.trim();
  if (q) {
    const clause = searchClause(columns, q);
    if (!clause) {
      return NextResponse.json({
        rows: [],
        count: 0,
        notice: "This table has no text columns to search.",
      });
    }
    query = query.or(clause);
  }

  const sort = searchParams.get("sort");
  if (sort) {
    if (!columns.some((c) => c.name === sort)) {
      return NextResponse.json({ error: `Unknown column: ${sort}` }, { status: 400 });
    }
    query = query.order(sort, { ascending: searchParams.get("dir") !== "desc" });
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ rows: data ?? [], count: count ?? 0 });
}

