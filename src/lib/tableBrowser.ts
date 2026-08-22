// Schema introspection for the read-only table browser (/tables).
//
// Supabase doesn't expose information_schema over PostgREST, but PostgREST
// itself publishes an OpenAPI (Swagger 2.0) description of everything it
// serves at the REST root. Fetching that with the service-role key gives us
// every table/view in the exposed schema plus each column's Postgres type,
// nullability, default, and the primary/foreign key notes PostgREST embeds in
// the column description. That means the browser needs no migration, no RPC,
// and no extra grants — it reads the same metadata Supabase's own API docs
// page is generated from.
//
// Rows themselves are read through the normal PostgREST endpoints (see
// /api/tables/rows), so filtering, sorting, and exact counts come for free.

export interface ColumnInfo {
  name: string;
  /** Postgres type, e.g. "uuid", "timestamp with time zone", "jsonb". */
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  /** "table.column" when PostgREST reports a foreign key, else null. */
  references: string | null;
  default: string | null;
  description: string | null;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

const SPEC_TTL_MS = 60_000;

let cache: { at: number; tables: TableInfo[] } | null = null;

interface SwaggerProperty {
  format?: string;
  type?: string;
  description?: string;
  default?: unknown;
}

interface SwaggerDefinition {
  required?: string[];
  properties?: Record<string, SwaggerProperty>;
}

interface SwaggerSpec {
  definitions?: Record<string, SwaggerDefinition>;
  paths?: Record<string, unknown>;
}

function credentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or a Supabase key (SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }
  return { url: url.replace(/\/+$/, ""), key };
}

// PostgREST writes key metadata into the column description, e.g.
//   "Note:\nThis is a Primary Key<pk/>"
//   "Note:\nThis is a Foreign Key to `deals.id`.<fk table='deals' column='id'/>"
// Strip those markers back out so the UI can show a clean comment.
function parseDescription(raw: string | undefined): {
  isPrimaryKey: boolean;
  references: string | null;
  description: string | null;
} {
  if (!raw) return { isPrimaryKey: false, references: null, description: null };
  const isPrimaryKey = raw.includes("<pk/>");
  const fk = /<fk table='([^']*)' column='([^']*)'\/>/.exec(raw);
  const description =
    raw
      .replace(/<pk\/>/g, "")
      .replace(/<fk [^>]*\/>/g, "")
      .replace(/Note:\s*/g, "")
      .replace(/This is a Primary Key\.?/g, "")
      .replace(/This is a Foreign Key to `[^`]*`\.?/g, "")
      .trim() || null;
  return {
    isPrimaryKey,
    references: fk ? `${fk[1]}.${fk[2]}` : null,
    description,
  };
}

function toTables(spec: SwaggerSpec): TableInfo[] {
  const definitions = spec.definitions ?? {};
  // Definitions can include types that aren't browsable relations (RPC
  // argument shapes, for instance). Anything PostgREST serves as a table or
  // view also has a top-level path, so use that as the filter.
  const paths = new Set<string>();
  for (const path of Object.keys(spec.paths ?? {})) {
    if (path === "/" || !path.startsWith("/") || path.startsWith("/rpc/")) continue;
    const name = path.slice(1);
    paths.add(name);
    // A name like "Sales Board" may come back percent-encoded in the path key.
    try {
      paths.add(decodeURIComponent(name));
    } catch {
      // Not valid encoding — the raw name above is what we have.
    }
  }

  const tables: TableInfo[] = [];
  for (const [name, def] of Object.entries(definitions)) {
    if (paths.size > 0 && !paths.has(name)) continue;
    const required = new Set(def.required ?? []);
    const columns: ColumnInfo[] = Object.entries(def.properties ?? {}).map(
      ([colName, prop]) => {
        const meta = parseDescription(prop.description);
        return {
          name: colName,
          type: prop.format || prop.type || "unknown",
          nullable: !required.has(colName) && !meta.isPrimaryKey,
          isPrimaryKey: meta.isPrimaryKey,
          references: meta.references,
          default: prop.default === undefined ? null : String(prop.default),
          description: meta.description,
        };
      },
    );
    tables.push({ name, columns });
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return tables;
}

/**
 * Every table/view the project's REST API exposes, with column metadata.
 * Cached briefly so flipping between tables doesn't refetch the spec.
 */
export async function listTables(force = false): Promise<TableInfo[]> {
  if (!force && cache && Date.now() - cache.at < SPEC_TTL_MS) return cache.tables;

  const { url, key } = credentials();
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      // Without this PostgREST may answer with its plain root document; the
      // OpenAPI media type is what asks for the full schema description.
      Accept: "application/openapi+json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Supabase schema request failed (${res.status} ${res.statusText})${
        body ? `: ${body.slice(0, 300)}` : ""
      }`,
    );
  }

  const spec = (await res.json()) as SwaggerSpec;
  const tables = toTables(spec);
  cache = { at: Date.now(), tables };
  return tables;
}

/** Resolves a caller-supplied table name against the real schema. */
export async function findTable(name: string): Promise<TableInfo | null> {
  const tables = await listTables();
  return tables.find((t) => t.name === name) ?? null;
}

const SIMPLE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * PostgREST accepts double-quoted identifiers where a bare one would be
 * ambiguous — needed here because real tables have names like "Sales Board".
 */
export function quoteIdentifier(name: string): string {
  return SIMPLE_IDENTIFIER.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

export function isSimpleIdentifier(name: string): boolean {
  return SIMPLE_IDENTIFIER.test(name);
}

// Only these accept `ilike` directly. Postgres has no uuid/jsonb ~~* operator,
// so including those types in a search would fail the whole query.
const TEXTUAL_TYPES = new Set(["text", "character varying", "character", "citext", "name"]);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Columns a free-text search can scan with ilike. */
export function searchableColumns(table: TableInfo): ColumnInfo[] {
  return table.columns.filter(
    // Odd column names would need quoting inside an `or(...)` expression,
    // which PostgREST parses differently from a normal filter — skip them
    // rather than risk a malformed query.
    (c) => isSimpleIdentifier(c.name) && TEXTUAL_TYPES.has(c.type),
  );
}

/** uuid columns, matched with `eq` when the search term is itself a uuid. */
export function uuidColumns(table: TableInfo): ColumnInfo[] {
  return table.columns.filter((c) => isSimpleIdentifier(c.name) && c.type === "uuid");
}
