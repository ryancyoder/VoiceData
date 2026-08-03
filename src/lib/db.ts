import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export type ColumnType = "text" | "integer" | "real" | "boolean" | "date";

export interface ColumnDef {
  name: string;
  type: ColumnType;
}

export interface TableSchema {
  name: string;
  columns: ColumnDef[];
}

const SQLITE_TYPE: Record<ColumnType, string> = {
  text: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "INTEGER",
  date: "TEXT",
};

const IDENTIFIER_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,62}$/;
const RESERVED_NAMES = new Set([
  "id",
  "created_at",
  "updated_at",
  "sqlite_sequence",
  "meta_tables",
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

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "voicedata.sqlite3");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_tables (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function assertTableExists(name: string): void {
  const row = getDb()
    .prepare(`SELECT name FROM meta_tables WHERE name = ?`)
    .get(name);
  if (!row) {
    throw new Error(
      `Table "${name}" does not exist. Use create_table first, or check list_tables for available tables.`
    );
  }
}

export function listTables(): string[] {
  const rows = getDb()
    .prepare(`SELECT name FROM meta_tables ORDER BY name`)
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

export function describeTable(name: string): TableSchema {
  assertTableExists(name);
  const cols = getDb().prepare(`PRAGMA table_info("${name}")`).all() as {
    name: string;
    type: string;
  }[];
  return {
    name,
    columns: cols
      .filter((c) => !RESERVED_NAMES.has(c.name.toLowerCase()))
      .map((c) => ({
        name: c.name,
        type: (c.type.toLowerCase() as ColumnType) || "text",
      })),
  };
}

export function describeDatabase(): TableSchema[] {
  return listTables().map(describeTable);
}

export function createTable(name: string, columns: ColumnDef[]): TableSchema {
  assertIdentifier(name, "table");
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new Error(`Table name "${name}" is reserved.`);
  }
  const database = getDb();
  const existing = database
    .prepare(`SELECT name FROM meta_tables WHERE name = ?`)
    .get(name);
  if (existing) {
    throw new Error(
      `Table "${name}" already exists. Use add_column to modify it or query_rows to read it.`
    );
  }
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
    if (!SQLITE_TYPE[col.type]) {
      throw new Error(`Invalid column type "${col.type}" for "${col.name}".`);
    }
  }

  const columnSql = columns
    .map((c) => `"${c.name}" ${SQLITE_TYPE[c.type]}`)
    .join(", ");

  const createTx = database.transaction(() => {
    database.exec(`
      CREATE TABLE "${name}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${columnSql},
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    database.prepare(`INSERT INTO meta_tables (name) VALUES (?)`).run(name);
  });
  createTx();

  return describeTable(name);
}

export function deleteTable(name: string): void {
  assertTableExists(name);
  const database = getDb();
  const tx = database.transaction(() => {
    database.exec(`DROP TABLE "${name}"`);
    database.prepare(`DELETE FROM meta_tables WHERE name = ?`).run(name);
  });
  tx();
}

export function addColumn(
  table: string,
  column: ColumnDef
): TableSchema {
  assertTableExists(table);
  assertColumnName(column.name);
  if (!SQLITE_TYPE[column.type]) {
    throw new Error(`Invalid column type "${column.type}".`);
  }
  const schema = describeTable(table);
  if (schema.columns.some((c) => c.name.toLowerCase() === column.name.toLowerCase())) {
    throw new Error(`Column "${column.name}" already exists on "${table}".`);
  }
  getDb().exec(
    `ALTER TABLE "${table}" ADD COLUMN "${column.name}" ${SQLITE_TYPE[column.type]}`
  );
  return describeTable(table);
}

function validateRowData(
  table: string,
  data: Record<string, unknown>
): void {
  const schema = describeTable(table);
  const validCols = new Set(schema.columns.map((c) => c.name));
  for (const key of Object.keys(data)) {
    if (!validCols.has(key)) {
      throw new Error(
        `Column "${key}" does not exist on table "${table}". Existing columns: ${[
          ...validCols,
        ].join(", ")}`
      );
    }
  }
}

export function insertRow(
  table: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  assertTableExists(table);
  validateRowData(table, data);
  const keys = Object.keys(data);
  const database = getDb();
  const columnsSql = keys.map((k) => `"${k}"`).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const stmt = database.prepare(
    `INSERT INTO "${table}" (${columnsSql}) VALUES (${placeholders})`
  );
  const info = stmt.run(...keys.map((k) => normalizeValue(data[k])));
  return database
    .prepare(`SELECT * FROM "${table}" WHERE id = ?`)
    .get(info.lastInsertRowid) as Record<string, unknown>;
}

export function updateRow(
  table: string,
  id: number,
  data: Record<string, unknown>
): Record<string, unknown> {
  assertTableExists(table);
  validateRowData(table, data);
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error("No fields provided to update.");
  }
  const database = getDb();
  const setSql = keys.map((k) => `"${k}" = ?`).join(", ");
  const stmt = database.prepare(
    `UPDATE "${table}" SET ${setSql}, updated_at = datetime('now') WHERE id = ?`
  );
  const info = stmt.run(...keys.map((k) => normalizeValue(data[k])), id);
  if (info.changes === 0) {
    throw new Error(`No row with id ${id} found in "${table}".`);
  }
  return database
    .prepare(`SELECT * FROM "${table}" WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

export function deleteRow(table: string, id: number): void {
  assertTableExists(table);
  const database = getDb();
  const info = database
    .prepare(`DELETE FROM "${table}" WHERE id = ?`)
    .run(id);
  if (info.changes === 0) {
    throw new Error(`No row with id ${id} found in "${table}".`);
  }
}

export function queryRows(
  table: string,
  filters?: Record<string, unknown>,
  limit = 100
): Record<string, unknown>[] {
  assertTableExists(table);
  const database = getDb();
  let sql = `SELECT * FROM "${table}"`;
  const params: unknown[] = [];
  if (filters && Object.keys(filters).length > 0) {
    validateRowData(table, filters);
    const clauses = Object.keys(filters).map((k) => `"${k}" = ?`);
    sql += ` WHERE ${clauses.join(" AND ")}`;
    params.push(...Object.keys(filters).map((k) => normalizeValue(filters[k])));
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(Math.max(limit, 1), 500));
  return database.prepare(sql).all(...params) as Record<string, unknown>[];
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}
