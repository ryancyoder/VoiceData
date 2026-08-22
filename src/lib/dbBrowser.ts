// Schema introspection for the read-only table browser (/database).
//
// PostgREST publishes an OpenAPI (swagger 2.0) document at the REST root, which
// is the only schema introspection Supabase exposes over the wire —
// information_schema isn't reachable through the client. `definitions` there
// holds one entry per exposed table/view, with each column's real Postgres type
// in `format` and its primary/foreign-key role encoded in `description`. That
// keeps this feature entirely read-only: nothing has to be added to the
// database for it to work.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface ForeignKey {
  table: string;
  column: string;
}

export interface ColumnMeta {
  name: string;
  /** The Postgres type as PostgREST reports it, e.g. "text", "jsonb", "timestamp with time zone". */
  type: string;
  isPrimaryKey: boolean;
  foreignKey: ForeignKey | null;
  /** The column's COMMENT, if it has one (the key/type notes are stripped out). */
  description: string | null;
}

export interface TableMeta {
  name: string;
  columns: ColumnMeta[];
}

// Postgres types `ilike` accepts. The free-text search box ORs a `%value%`
// match across these; running ilike against a uuid or an int errors out
// ("operator does not exist"), so anything else is left out of the search.
const TEXT_TYPES = new Set([
  "text",
  "character varying",
  "character",
  "name",
  "citext",
]);

export function isSearchableType(type: string): boolean {
  return TEXT_TYPES.has(type.toLowerCase());
}

interface SwaggerProperty {
  type?: string;
  format?: string;
  description?: string;
  items?: { type?: string; format?: string };
}

interface SwaggerDefinition {
  properties?: Record<string, SwaggerProperty>;
}

interface SwaggerDoc {
  definitions?: Record<string, SwaggerDefinition>;
}

// PostgREST writes the key notes into the column description, e.g.
//   "Some comment\n\nNote:\nThis is a Primary Key.<pk/>"
//   "Note:\nThis is a Foreign Key to `properties.id`.<fk table='properties' column='id'/>"
const FK_RE = /<fk\s+table='([^']*)'\s+column='([^']*)'\s*\/>/;

function parseDescription(raw: string | undefined): {
  isPrimaryKey: boolean;
  foreignKey: ForeignKey | null;
  description: string | null;
} {
  if (!raw) return { isPrimaryKey: false, foreignKey: null, description: null };

  const fkMatch = raw.match(FK_RE);
  // Everything from the "Note:" block on is PostgREST's own annotation; what
  // comes before it is the column's actual COMMENT (usually nothing).
  const comment = raw.split(/\n*Note:\n/)[0].replace(/<[^>]+>/g, "").trim();

  return {
    isPrimaryKey: raw.includes("<pk/>"),
    foreignKey: fkMatch ? { table: fkMatch[1], column: fkMatch[2] } : null,
    description: comment || null,
  };
}

function columnType(prop: SwaggerProperty): string {
  // `format` carries the real Postgres type; `type` is the JSON type and is
  // only a fallback. Arrays come through as format "ARRAY" with the element
  // type in `items`.
  const format = prop.format;
  if (format === "ARRAY" && prop.items?.format) return `${prop.items.format}[]`;
  return format || prop.type || "unknown";
}

// The spec is a few hundred KB and changes only when the schema does, so one
// fetch per minute per server instance is plenty.
const CACHE_TTL_MS = 60_000;
let cache: { at: number; tables: TableMeta[] } | null = null;

export async function loadTables(force = false): Promise<TableMeta[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.tables;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }
  // Same identity rule as supabaseClient: service role on the server when it's
  // configured (so the browser keeps working with RLS locked down), anon key
  // otherwise.
  const key = serviceKey || anonKey;
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
    );
  }

  const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/openapi+json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Schema request failed: ${res.status} ${res.statusText}`);
  }

  const doc = (await res.json()) as SwaggerDoc;
  const definitions = doc.definitions;
  if (!definitions) {
    throw new Error("Schema response had no table definitions.");
  }

  const tables: TableMeta[] = Object.entries(definitions)
    // Stored-procedure argument shapes are listed as "(rpc) name" — not tables.
    .filter(([name]) => !name.startsWith("("))
    .map(([name, def]) => ({
      name,
      columns: Object.entries(def.properties || {}).map(([colName, prop]) => ({
        name: colName,
        type: columnType(prop),
        ...parseDescription(prop.description),
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cache = { at: Date.now(), tables };
  return tables;
}
