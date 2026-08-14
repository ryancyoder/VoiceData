import { supabase } from "./supabaseClient";

export type ColumnType = "text" | "integer" | "real" | "boolean" | "date";

export interface ColumnDef {
  name: string;
  type: ColumnType;
}

export interface TableSchema {
  name: string;
  columns: ColumnDef[];
}

// The voice agent creates arbitrary tables and columns at runtime. Rather than
// run live DDL against Postgres (which needs raw-SQL RPC, per-table RLS, and
// pollutes the app schema), we model the user's "database" as data inside two
// fixed, service-role-only tables:
//
//   voicedata_tables  — one row per user-defined table: its name + column list
//   voicedata_rows    — one row per user row: { table_name, data(jsonb) }
//
// This persists on the serverless deploy (the old local better-sqlite3 file
// could not — the filesystem is read-only/ephemeral there) and stays behind the
// same lockdown as everything else: RLS is enabled with no anon policy, so only
// our server code, using the service-role key, can touch it.
const TABLES = "voicedata_tables";
const ROWS = "voicedata_rows";

const VALID_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  "text",
  "integer",
  "real",
  "boolean",
  "date",
]);

const IDENTIFIER_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;
const RESERVED_NAMES = new Set([
  "id",
  "created_at",
  "updated_at",
  "table_name",
  "data",
]);

function assertIdentifier(name: string, kind: "table" | "column"): void {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(
      `Invalid ${kind} name "${name}": must start with a letter and contain only letters, numbers, and underscores.`
    );
  }
  if (name.toLowerCase().startsWith("sqlite_")) {
    throw new Error(`Invalid ${kind} name "${name}": reserved prefix.`);
  }
}

function assertColumnName(name: string): void {
  assertIdentifier(name, "column");
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new Error(`Column name "${name}" is reserved.`);
  }
}

interface TableRecord {
  name: string;
  columns: ColumnDef[];
}

async function getTableRecord(name: string): Promise<TableRecord | null> {
  const { data, error } = await supabase
    .from(TABLES)
    .select("name, columns")
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { name: data.name as string, columns: (data.columns ?? []) as ColumnDef[] };
}

async function requireTableRecord(name: string): Promise<TableRecord> {
  const rec = await getTableRecord(name);
  if (!rec) {
    throw new Error(
      `Table "${name}" does not exist. Use create_table first, or check list_tables for available tables.`
    );
  }
  return rec;
}

export async function listTables(): Promise<string[]> {
  const { data, error } = await supabase
    .from(TABLES)
    .select("name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.name as string);
}

export async function describeTable(name: string): Promise<TableSchema> {
  const rec = await requireTableRecord(name);
  return { name: rec.name, columns: rec.columns };
}

export async function describeDatabase(): Promise<TableSchema[]> {
  const { data, error } = await supabase
    .from(TABLES)
    .select("name, columns")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    name: r.name as string,
    columns: (r.columns ?? []) as ColumnDef[],
  }));
}

function validateColumns(columns: ColumnDef[]): void {
  if (columns.length === 0) {
    throw new Error("At least one column is required.");
  }
  const seen = new Set<string>();
  for (const col of columns) {
    assertColumnName(col.name);
    if (seen.has(col.name.toLowerCase())) {
      throw new Error(`Duplicate column name "${col.name}".`);
    }
    seen.add(col.name.toLowerCase());
    if (!VALID_TYPES.has(col.type)) {
      throw new Error(`Invalid column type "${col.type}" for "${col.name}".`);
    }
  }
}

export async function createTable(
  name: string,
  columns: ColumnDef[]
): Promise<TableSchema> {
  assertIdentifier(name, "table");
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new Error(`Table name "${name}" is reserved.`);
  }
  if (await getTableRecord(name)) {
    throw new Error(
      `Table "${name}" already exists. Use add_column to modify it or query_rows to read it.`
    );
  }
  validateColumns(columns);

  const { error } = await supabase.from(TABLES).insert({ name, columns });
  if (error) throw new Error(error.message);
  return { name, columns };
}

export async function deleteTable(name: string): Promise<void> {
  await requireTableRecord(name);
  // voicedata_rows has an ON DELETE CASCADE FK to voicedata_tables, so removing
  // the table record removes all its rows too.
  const { error } = await supabase.from(TABLES).delete().eq("name", name);
  if (error) throw new Error(error.message);
}

export async function addColumn(
  table: string,
  column: ColumnDef
): Promise<TableSchema> {
  const rec = await requireTableRecord(table);
  assertColumnName(column.name);
  if (!VALID_TYPES.has(column.type)) {
    throw new Error(`Invalid column type "${column.type}".`);
  }
  if (
    rec.columns.some(
      (c) => c.name.toLowerCase() === column.name.toLowerCase()
    )
  ) {
    throw new Error(`Column "${column.name}" already exists on "${table}".`);
  }
  const columns = [...rec.columns, { name: column.name, type: column.type }];
  const { error } = await supabase
    .from(TABLES)
    .update({ columns })
    .eq("name", table);
  if (error) throw new Error(error.message);
  return { name: table, columns };
}

function validateRowData(
  schema: TableSchema,
  data: Record<string, unknown>
): void {
  const validCols = new Set(schema.columns.map((c) => c.name));
  for (const key of Object.keys(data)) {
    if (!validCols.has(key)) {
      throw new Error(
        `Column "${key}" does not exist on table "${schema.name}". Existing columns: ${[
          ...validCols,
        ].join(", ")}`
      );
    }
  }
}

// Reconstruct the flat row shape callers expect: { id, ...userColumns,
// created_at, updated_at } — matching the old SELECT * result.
function flattenRow(row: {
  id: number;
  data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}): Record<string, unknown> {
  return {
    id: row.id,
    ...(row.data ?? {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function insertRow(
  table: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const schema = await describeTable(table);
  validateRowData(schema, data);
  const clean = normalizeData(data);
  const { data: row, error } = await supabase
    .from(ROWS)
    .insert({ table_name: table, data: clean })
    .select("id, data, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return flattenRow(row);
}

export async function updateRow(
  table: string,
  id: number,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const schema = await describeTable(table);
  validateRowData(schema, data);
  if (Object.keys(data).length === 0) {
    throw new Error("No fields provided to update.");
  }
  const { data: existing, error: readErr } = await supabase
    .from(ROWS)
    .select("id, data, created_at, updated_at")
    .eq("table_name", table)
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!existing) {
    throw new Error(`No row with id ${id} found in "${table}".`);
  }
  // Merge onto the existing row so unspecified columns are preserved (the old
  // UPDATE ... SET only touched the provided columns).
  const merged = {
    ...((existing.data ?? {}) as Record<string, unknown>),
    ...normalizeData(data),
  };
  const { data: row, error } = await supabase
    .from(ROWS)
    .update({ data: merged, updated_at: new Date().toISOString() })
    .eq("table_name", table)
    .eq("id", id)
    .select("id, data, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return flattenRow(row);
}

export async function deleteRow(table: string, id: number): Promise<void> {
  await requireTableRecord(table);
  const { data, error } = await supabase
    .from(ROWS)
    .delete()
    .eq("table_name", table)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(`No row with id ${id} found in "${table}".`);
  }
}

export async function queryRows(
  table: string,
  filters?: Record<string, unknown>,
  limit = 100
): Promise<Record<string, unknown>[]> {
  const schema = await describeTable(table);
  if (filters && Object.keys(filters).length > 0) {
    validateRowData(schema, filters);
  }
  const { data, error } = await supabase
    .from(ROWS)
    .select("id, data, created_at, updated_at")
    .eq("table_name", table)
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);

  let rows = (data ?? []).map(flattenRow);
  if (filters && Object.keys(filters).length > 0) {
    const entries = Object.entries(filters).map(
      ([k, v]) => [k, normalizeValue(v)] as const
    );
    rows = rows.filter((row) =>
      entries.every(([k, v]) => valuesEqual(row[k], v))
    );
  }
  const capped = Math.min(Math.max(limit, 1), 500);
  return rows.slice(0, capped);
}

// Loose equality for filter matching, mirroring SQLite's forgiving comparison
// (e.g. filtering a boolean column by true still matches).
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  return String(a) === String(b);
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}

function normalizeData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = normalizeValue(v);
  return out;
}
