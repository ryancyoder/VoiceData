// The columns the Plant Reference editor is allowed to write, and how each
// incoming JSON value is coerced on the way to Postgres.
//
// Extracted from the PATCH route so creating a plant and editing one cannot
// drift apart: a field added to the editor should become writable in both
// places at once, and the create path should never accept a column the edit
// path refuses. id/image/last_updated/source_file stay managed elsewhere
// (image via the /image route, last_updated stamped server-side).

export const TEXT_FIELDS = [
  "type",
  "category",
  "genus",
  "species",
  "cultivar",
  "botanical",
  "common",
  "zone",
  "texture",
  "form",
  "growth_rate",
  "pollinator_value",
  "matrix_role",
  "source_url",
] as const;

export const NUMBER_FIELDS = ["height_in", "width_in", "spread_in"] as const;

export const BOOL_FIELDS = ["native", "deer_resistant", "rabbit_resistant", "evergreen"] as const;

export const ARRAY_FIELDS = [
  "sun",
  "soil",
  "soil_ph",
  "moisture",
  "bloom_season",
  "bloom_color",
  "foliage_color",
  "attracts",
  "seasonal_interest",
  "design_style",
  "features",
] as const;

export function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  // The size columns are integer, so round rather than let a decimal reach
  // Postgres (which would reject it).
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function cleanArray(v: unknown): string[] | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const cleaned = arr
    .map((x) => (typeof x === "string" ? x.trim() : String(x).trim()))
    .filter(Boolean);
  return cleaned.length ? cleaned : null;
}

// Whitelist an incoming body down to writable columns. Only keys actually
// present in the body are returned, so a PATCH stays a partial update.
export function plantColumnsFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) if (f in body) out[f] = cleanText(body[f]);
  for (const f of NUMBER_FIELDS) if (f in body) out[f] = cleanNumber(body[f]);
  for (const f of BOOL_FIELDS) if (f in body) out[f] = Boolean(body[f]);
  for (const f of ARRAY_FIELDS) if (f in body) out[f] = cleanArray(body[f]);
  return out;
}

// `Acer palmatum 'Crimson Queen'` — the form the rest of the library uses, and
// the one plantpix's name matcher reads when it goes looking for a photograph.
//
// Composed only when the editor left `botanical` empty, and from exactly what
// was typed: the epithet is conventionally lower case, but silently recasing a
// field the user filled in is how a catalog ends up disagreeing with itself.
export function composeBotanical(
  genus: string | null,
  species: string | null,
  cultivar: string | null,
): string | null {
  const parts = [genus, species].filter((p): p is string => !!p && !!p.trim()).map((p) => p.trim());
  const cv = cultivar?.trim();
  if (cv) parts.push(`'${cv.replace(/^['’]|['’]$/g, "")}'`);
  const composed = parts.join(" ").trim();
  return composed || null;
}
