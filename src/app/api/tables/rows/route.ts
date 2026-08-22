import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  findTable,
  quoteIdentifier,
  searchableColumns,
  uuidColumns,
  UUID_RE,
} from "@/lib/tableBrowser";

// Row feed for the table browser (/tables). Read-only: this route only ever
// SELECTs. The table and every filtered column are checked against the real
// schema first, so a caller can't point it at something PostgREST doesn't
// already expose.

const MAX_LIMIT = 200;

type Op =
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

const OPS = new Set<string>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "startsWith",
  "endsWith",
  "in",
  "is_null",
  "not_null",
]);

interface Filter {
  column: string;
  op: Op;
  value: string;
}

function parseFilters(raw: string | null): Filter[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("filters must be a JSON array");
  }
  if (!Array.isArray(parsed)) throw new Error("filters must be a JSON array");
  return parsed.map((entry) => {
    const f = entry as { column?: unknown; op?: unknown; value?: unknown };
    if (typeof f.column !== "string" || typeof f.op !== "string" || !OPS.has(f.op)) {
      throw new Error("each filter needs a column and a supported op");
    }
    return {
      column: f.column,
      op: f.op as Op,
      value: f.value == null ? "" : String(f.value),
    };
  });
}

// PostgREST reads `,` `.` `(` `)` as syntax inside a filter value; double
// quoting the value keeps them literal.
function quoteValue(value: string): string {
  if (!/[,()"\\]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const tableName = params.get("table");
  if (!tableName) {
    return NextResponse.json({ error: "table is required" }, { status: 400 });
  }

  let table;
  try {
    table = await findTable(tableName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!table) {
    return NextResponse.json({ error: `Unknown table "${tableName}"` }, { status: 404 });
  }

  const columnNames = new Set(table.columns.map((c) => c.name));

  const limit = Math.min(
    Math.max(Number.parseInt(params.get("limit") ?? "50", 10) || 50, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(Number.parseInt(params.get("offset") ?? "0", 10) || 0, 0);

  const orderColumn = params.get("order");
  if (orderColumn && !columnNames.has(orderColumn)) {
    return NextResponse.json(
      { error: `Unknown column "${orderColumn}"` },
      { status: 400 },
    );
  }
  const ascending = params.get("dir") !== "desc";

  let filters: Filter[];
  try {
    filters = parseFilters(params.get("filters"));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  for (const f of filters) {
    if (!columnNames.has(f.column)) {
      return NextResponse.json({ error: `Unknown column "${f.column}"` }, { status: 400 });
    }
  }

  let query = supabase.from(table.name).select("*", { count: "exact" });

  for (const f of filters) {
    const col = quoteIdentifier(f.column);
    switch (f.op) {
      case "is_null":
        query = query.is(col, null);
        break;
      case "not_null":
        query = query.not(col, "is", null);
        break;
      case "contains":
        query = query.filter(col, "ilike", quoteValue(`%${f.value}%`));
        break;
      case "startsWith":
        query = query.filter(col, "ilike", quoteValue(`${f.value}%`));
        break;
      case "endsWith":
        query = query.filter(col, "ilike", quoteValue(`%${f.value}`));
        break;
      case "in":
        query = query.in(
          col,
          f.value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        );
        break;
      default:
        query = query.filter(col, f.op, quoteValue(f.value));
    }
  }

  // Free-text search: ilike across the text columns, plus an exact match on
  // uuid columns when the term is itself a uuid (Postgres has no uuid ilike).
  const search = (params.get("search") ?? "").trim();
  if (search) {
    const escaped = search.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const clauses = searchableColumns(table).map((c) => `${c.name}.ilike."%${escaped}%"`);
    if (UUID_RE.test(search)) {
      clauses.push(...uuidColumns(table).map((c) => `${c.name}.eq.${search}`));
    }
    if (clauses.length === 0) {
      return NextResponse.json({
        rows: [],
        count: 0,
        unsearchable: true,
      });
    }
    query = query.or(clauses.join(","));
  }

  const ordered = orderColumn
    ? query.order(quoteIdentifier(orderColumn), { ascending, nullsFirst: false })
    : query;

  const { data, error, count } = await ordered.range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ rows: data ?? [], count: count ?? 0 });
}
