import { supabase } from "@/lib/supabaseClient";
import type { ColumnMeta, TableMeta } from "@/lib/dbBrowserTypes";
import { MAX_CELL_CHARS } from "@/lib/dbBrowserTypes";
import type { BrowseRow } from "@/lib/dbBrowserTypes";

// Server-side plumbing for the /db table browser.
//
// PostgREST can't list tables or describe columns, so the schema comes from two
// read-only Postgres functions installed alongside this feature —
// db_browser_schema() and db_browser_counts(). They're granted to service_role
// only, so this module only works from server code holding the service-role key
// (see docs/db-browser.md and SECURITY_LOCKDOWN.md).

export type { ColumnMeta, TableMeta, BrowseRow } from "@/lib/dbBrowserTypes";
export {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  MAX_PAGE_SIZE,
  MAX_CELL_CHARS,
} from "@/lib/dbBrowserTypes";

/** The RPCs aren't installed on this project (or the anon key is in play). */
export class MissingIntrospectionError extends Error {
  constructor(cause: string) {
    super(
      `The table browser's database functions are missing or unreachable (${cause}). ` +
        "Run the SQL in docs/db-browser.md against this Supabase project, and make sure " +
        "SUPABASE_SERVICE_ROLE_KEY is set — the functions are granted to service_role only."
    );
    this.name = "MissingIntrospectionError";
  }
}

// PGRST202 = "function not found in schema cache", 42883 = no such function,
// PGRST301 = the JWT in play can't execute it. All three mean the same thing to
// the caller: the introspection functions aren't reachable.
const SETUP_ERROR_CODES = new Set(["PGRST202", "42883", "PGRST301"]);

function rethrow(error: { code?: string; message: string }): never {
  if (error.code && SETUP_ERROR_CODES.has(error.code)) {
    throw new MissingIntrospectionError(error.message);
  }
  throw new Error(error.message);
}

const SCHEMA_TTL_MS = 30_000;
let schemaCache: { at: number; tables: TableMeta[] } | null = null;

export async function loadSchema(refresh = false): Promise<TableMeta[]> {
  if (!refresh && schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL_MS) {
    return schemaCache.tables;
  }

  const { data, error } = await supabase.rpc("db_browser_schema");
  if (error) rethrow(error);

  const tables = (Array.isArray(data) ? (data as TableMeta[]) : []).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  schemaCache = { at: Date.now(), tables };
  return tables;
}

export async function loadRowCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("db_browser_counts");
  if (error) rethrow(error);

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { table_name: string; row_count: number }[]) {
    counts[row.table_name] = Number(row.row_count);
  }
  return counts;
}

// ─── Column type helpers ────────────────────────────────────────────────────

/** Types `ilike` accepts directly, without a cast PostgREST can't express. */
function isTextish(type: string): boolean {
  return /^(text|character varying|character|citext|name|xml)/.test(type);
}

function isNumeric(type: string): boolean {
  return /^(smallint|integer|bigint|numeric|real|double precision|decimal)/.test(type);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST's `or=(…)` list is delimited by commas and parentheses, so a value
 * containing any of those has to be double-quoted, with inner quotes and
 * backslashes escaped. Plain terms are left bare — that's the same shape the
 * rest of the app's search endpoints already send.
 */
function filterValue(value: string): string {
  if (!/[,.()"\\ ]/.test(value)) return value;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function quoteColumn(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

/**
 * A single `or=(…)` expression matching `term` across every column that can be
 * compared to it: substring match on text columns, exact match on uuid columns
 * when the term is a uuid, exact match on number columns when it's a number.
 * Returns null when the table has nothing comparable.
 */
export function buildSearchFilter(columns: ColumnMeta[], term: string): string | null {
  const clauses: string[] = [];
  const numeric = term.trim() !== "" && Number.isFinite(Number(term));

  for (const col of columns) {
    const name = quoteColumn(col.name);
    if (isTextish(col.type)) {
      // `%` rather than PostgREST's `*` shorthand — it's what ILIKE itself
      // wants, so nothing has to rewrite the value on the way in. A `%` or `_`
      // typed into the search box is therefore a wildcard.
      clauses.push(`${name}.ilike.${filterValue(`%${term}%`)}`);
    } else if (col.type === "uuid" && UUID_RE.test(term)) {
      clauses.push(`${name}.eq.${term}`);
    } else if (isNumeric(col.type) && numeric) {
      clauses.push(`${name}.eq.${Number(term)}`);
    }
  }

  return clauses.length ? clauses.join(",") : null;
}

/**
 * Pagination needs a stable order. Newest-first is the useful default for
 * anything with a timestamp; otherwise fall back to the primary key (descending,
 * so recent rows lead) and finally to the first column.
 */
export function defaultSort(table: TableMeta): { column: string; ascending: boolean } | null {
  const byName = (name: string) => table.columns.find((c) => c.name === name);
  const created = byName("created_at") ?? byName("inserted_at") ?? byName("created");
  if (created) return { column: created.name, ascending: false };

  const pk = table.columns.find((c) => c.is_primary_key);
  if (pk) return { column: pk.name, ascending: false };

  return table.columns[0] ? { column: table.columns[0].name, ascending: true } : null;
}

export function primaryKeyColumns(table: TableMeta): ColumnMeta[] {
  return table.columns.filter((c) => c.is_primary_key);
}

/** Shorten oversized values and record which columns were cut. */
export function truncateRow(row: Record<string, unknown>): BrowseRow {
  const out: BrowseRow = {};
  const truncated: string[] = [];

  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && value.length > MAX_CELL_CHARS) {
      out[key] = value.slice(0, MAX_CELL_CHARS);
      truncated.push(key);
      continue;
    }
    if (value !== null && typeof value === "object") {
      const json = JSON.stringify(value);
      if (json && json.length > MAX_CELL_CHARS) {
        out[key] = json.slice(0, MAX_CELL_CHARS);
        truncated.push(key);
        continue;
      }
    }
    out[key] = value;
  }

  if (truncated.length) out.__truncated = truncated;
  return out;
}
