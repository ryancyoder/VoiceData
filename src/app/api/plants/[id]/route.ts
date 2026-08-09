import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { Plant } from "@/lib/plants";

type RouteParams = { params: Promise<{ id: string }> };

// Fetch a single reference plant by id (used to open a plant's detail from a
// combination's linked-plant list).
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }
  const { data, error } = await supabase.from("plants").select("*").eq("id", plantId).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ plant: data as Plant });
}

// Columns the Plant Reference editor is allowed to change, grouped by how the
// incoming JSON value is coerced. id/image/last_updated/source_file are managed
// elsewhere (image via the /image route, last_updated set here automatically).
const TEXT_FIELDS = [
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

const NUMBER_FIELDS = ["height_in", "width_in", "spread_in"] as const;

const BOOL_FIELDS = ["native", "deer_resistant", "rabbit_resistant", "evergreen"] as const;

const ARRAY_FIELDS = [
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

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  // The size columns are integer, so round rather than let a decimal reach
  // Postgres (which would reject it).
  return Number.isFinite(n) ? Math.round(n) : null;
}

function cleanArray(v: unknown): string[] | null {
  if (v == null) return null;
  const arr = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(",")
      : [];
  const cleaned = arr
    .map((x) => (typeof x === "string" ? x.trim() : String(x).trim()))
    .filter(Boolean);
  return cleaned.length ? cleaned : null;
}

// Update editable fields on a single reference plant. Only whitelisted columns
// are applied; last_updated is stamped server-side.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) if (f in body) patch[f] = cleanText(body[f]);
  for (const f of NUMBER_FIELDS) if (f in body) patch[f] = cleanNumber(body[f]);
  for (const f of BOOL_FIELDS) if (f in body) patch[f] = Boolean(body[f]);
  for (const f of ARRAY_FIELDS) if (f in body) patch[f] = cleanArray(body[f]);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
  }
  patch.last_updated = new Date().toISOString();

  const { data: row, error } = await supabase
    .from("plants")
    .update(patch)
    .eq("id", plantId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ plant: row as Plant });
}
