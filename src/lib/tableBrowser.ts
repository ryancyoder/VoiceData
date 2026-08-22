import { supabase } from "@/lib/supabaseClient";

// ── Schema introspection ────────────────────────────────────────────────────
//
// The database is locked down (see SECURITY_LOCKDOWN.md): anon has no access,
// and the browser therefore can't talk to Supabase directly. Everything here
// runs on the server with the service-role key, behind the app's password gate.
//
// PostgREST publishes an OpenAPI (Swagger 2.0) document at the REST root that
// describes every table and view it exposes, including column names, Postgres
// types, and which columns are primary keys. That's the whole schema in one
// request, with no migration and no SQL-over-HTTP function to install.

export type ColumnInfo = {
  name: string;
  /** The Postgres type, e.g. `text`, `timestamp with time zone`, `text[]`. */
  type: string;
  /** JSON-schema type, used to pick an alignment/renderer. */
  jsonType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  /** `"Sales Board.id"` when this column is a foreign key, else null. */
  references: string | null;
  /** Allowed values, for Postgres enum columns. */
  enumValues: string[] | null;
};

export type TableInfo = {
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  /** True when PostgREST exposes no writes for it — i.e. a non-updatable view. */
  readOnly: boolean;
};

type SwaggerProperty = {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  items?: { type?: string; format?: string };
};

type SwaggerDefinition = {
  properties?: Record<string, SwaggerProperty>;
  required?: string[];
};

type SwaggerDoc = {
  definitions?: Record<string, SwaggerDefinition>;
  components?: { schemas?: Record<string, SwaggerDefinition> };
  paths?: Record<string, Record<string, unknown>>;
};

function restCredentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Mirrors supabaseClient.ts: prefer the service-role key, fall back to anon.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or a Supabase API key.");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

// PostgREST annotates primary and foreign keys in each property's description:
//   "Note:\nThis is a Primary Key.<pk/>"
//   "Note:\nThis is a Foreign Key to `Sales Board.id`.<fk table='Sales Board' column='id'/>"
const PK_MARKER = /<pk\/>/;
const FK_MARKER = /<fk table='([^']*)' column='([^']*)'\/>/;

function parseColumn(name: string, prop: SwaggerProperty, required: string[]): ColumnInfo {
  const description = prop.description ?? "";
  const fk = FK_MARKER.exec(description);

  // `format` carries the real Postgres type (`bigint`, `jsonb`, `text[]`, an
  // enum's type name); `type` is the coarse JSON-schema kind.
  let type = prop.format ?? prop.type ?? "unknown";
  if (prop.type === "array" && prop.items?.format) {
    type = `${prop.items.format}[]`;
  }

  return {
    name,
    type,
    jsonType: prop.type ?? "string",
    nullable: !required.includes(name),
    isPrimaryKey: PK_MARKER.test(description),
    references: fk ? `${fk[1]}.${fk[2]}` : null,
    enumValues: Array.isArray(prop.enum) && prop.enum.length > 0 ? prop.enum : null,
  };
}

function parseSchema(doc: SwaggerDoc): TableInfo[] {
  const definitions = doc.definitions ?? doc.components?.schemas ?? {};
  const paths = doc.paths ?? {};
  const tables: TableInfo[] = [];

  for (const [name, definition] of Object.entries(definitions)) {
    // Only keep definitions that are actually reachable as a collection. This
    // drops the parameter/response schemas PostgREST emits for RPCs, which
    // aren't tables and can't be browsed.
    const path = paths[`/${name}`];
    if (!path) continue;

    const required = definition.required ?? [];
    const columns = Object.entries(definition.properties ?? {}).map(([col, prop]) =>
      parseColumn(col, prop, required)
    );
    if (columns.length === 0) continue;

    tables.push({
      name,
      columns,
      primaryKey: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
      readOnly: !("post" in path),
    });
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));
  return tables;
}

// The schema changes rarely but every rows request needs it (to validate the
// table name), so hold it briefly in module memory rather than re-fetching.
const SCHEMA_TTL_MS = 60_000;
let cached: { at: number; tables: TableInfo[] } | null = null;

export async function listTables(force = false): Promise<TableInfo[]> {
  if (!force && cached && Date.now() - cached.at < SCHEMA_TTL_MS) {
    return cached.tables;
  }

  const { url, key } = restCredentials();
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/openapi+json",
      },
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(
      `Could not reach Supabase at ${url} (${err instanceof Error ? err.message : "network error"}).`
    );
  }

  if (!res.ok) {
    throw new Error(`Supabase schema request failed (${res.status} ${res.statusText}).`);
  }

  const tables = parseSchema((await res.json()) as SwaggerDoc);
  cached = { at: Date.now(), tables };
  return tables;
}

export async function findTable(name: string): Promise<TableInfo | null> {
  const hit = (await listTables()).find((t) => t.name === name);
  // A table added since the last cache fill would 404 spuriously, so miss once
  // against a fresh copy of the schema before giving up.
  if (hit) return hit;
  return (await listTables(true)).find((t) => t.name === name) ?? null;
}

// ── Row values ──────────────────────────────────────────────────────────────
//
// Some columns hold very large values — voicemap_images stores base64 data
// URLs — so a 50-row page of raw JSON can run to hundreds of megabytes and
// lock up the browser. Rows are flattened to display strings and clipped here,
// on the server, before anything is sent; the row detail panel re-requests the
// single row it needs in full.

export const MAX_CELL_CHARS = 240;

/** A single rendered cell. `null` means SQL NULL. */
export type Cell = { t: string; trunc?: true; len?: number } | null;
export type Row = Record<string, Cell>;

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // jsonb and array columns: pretty-print so the detail panel is readable.
  return JSON.stringify(value, null, 2) ?? "";
}

function toCell(value: unknown, full: boolean): Cell {
  if (value === null || value === undefined) return null;
  const text = toText(value);
  if (full || text.length <= MAX_CELL_CHARS) return { t: text };
  return { t: text.slice(0, MAX_CELL_CHARS), trunc: true, len: text.length };
}

export function toRow(record: Record<string, unknown>, columns: ColumnInfo[], full: boolean): Row {
  const row: Row = {};
  for (const column of columns) {
    row[column.name] = toCell(record[column.name], full);
  }
  return row;
}

// ── Row queries ─────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Postgres types worth running a text search against. */
function isSearchable(column: ColumnInfo): boolean {
  return /^(text|character varying|varchar|character|char|citext|name)$/.test(column.type);
}

/**
 * PostgREST parses `or=(...)` positionally, so a bare column name only works
 * when it has no reserved characters; anything else has to be quoted.
 */
function filterName(name: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : `"${name}"`;
}

export type RowQuery = {
  page: number;
  pageSize: number;
  sort: string | null;
  ascending: boolean;
  search: string;
};

export type RowResult = {
  rows: Row[];
  total: number;
  /** Columns the search actually ran against, so the UI can say so. */
  searchedColumns: string[];
};

export async function fetchRows(table: TableInfo, query: RowQuery): Promise<RowResult> {
  const from = (query.page - 1) * query.pageSize;
  let builder = supabase.from(table.name).select("*", { count: "exact" });

  // PostgREST leaves row order undefined without an ORDER BY, which makes
  // pagination non-deterministic. Sort by the requested column when it's real,
  // otherwise fall back to the primary key, and always break ties on the
  // primary key so pages can't overlap or skip rows.
  const sortColumn = table.columns.find((c) => c.name === query.sort)?.name ?? null;
  const orderBy = sortColumn ?? table.primaryKey[0] ?? table.columns[0]?.name ?? null;
  if (orderBy) {
    builder = builder.order(orderBy, { ascending: query.ascending, nullsFirst: false });
  }
  for (const pk of table.primaryKey) {
    if (pk !== orderBy) builder = builder.order(pk, { ascending: true });
  }

  // Strip the characters PostgREST treats as filter syntax rather than trying
  // to escape them — matches how /api/plants/albums sanitizes its query.
  const term = query.search.replace(/[%_,().*\\"]/g, " ").trim();
  const searchable = table.columns.filter(isSearchable);
  if (term && searchable.length > 0) {
    builder = builder.or(searchable.map((c) => `${filterName(c.name)}.ilike.*${term}*`).join(","));
  }

  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throw new Error(error.message);

  return {
    rows: (data ?? []).map((record) => toRow(record as Record<string, unknown>, table.columns, false)),
    total: count ?? 0,
    searchedColumns: term ? searchable.map((c) => c.name) : [],
  };
}

/** One row, untruncated, addressed by a single-column primary key. */
export async function fetchRowByKey(table: TableInfo, keyValue: string): Promise<Row | null> {
  if (table.primaryKey.length !== 1) return null;

  const { data, error } = await supabase
    .from(table.name)
    .select("*")
    .eq(table.primaryKey[0], keyValue)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return toRow(data as Record<string, unknown>, table.columns, true);
}
