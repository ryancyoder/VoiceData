// Mapping between the `catalog_items` typed columns (snake_case, the single
// source of truth) and the camelCase item shape the estimator frontend uses.
//
// Background: catalog items used to live entirely inside a `data` jsonb blob.
// Each jsonb key has been promoted to a first-class column so the catalog can
// be a typed, queryable source of truth shared across apps. The app now reads
// AND writes only the typed columns. The legacy `data` column still exists for
// readers not yet migrated (e.g. main), but it is a DB-maintained derived copy
// kept in sync by the `catalog_items_sync_data` trigger — the app never writes
// it, so dropping the column requires no app change.

// A catalog item as consumed by the frontend. Loosely typed on purpose: the
// editor carries a few optional feature flags and the object is passed around
// as a plain bag, so we keep an index signature while naming the known fields.
export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  isAssembly?: boolean;
  takeoffUnit?: string;
  coverageRate?: number;
  roundTo?: number;
  unitsPerLoad?: number;
  deliveryFee?: boolean;
  planSymbol?: string;
  itemSymbol?: string;
  description?: string;
  isWallAssembly?: boolean;
  pricePerFaceFt?: number;
  pricePerLinearFt?: number;
  [key: string]: unknown;
}

// The subset of `catalog_items` columns we read back. Numerics arrive from
// PostgREST as strings, so they're typed as `string | number | null` here and
// coerced in `rowToItem`.
export interface CatalogItemRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  unit_price: string | number | null;
  is_assembly: boolean | null;
  takeoff_unit: string | null;
  coverage_rate: string | number | null;
  round_to: string | number | null;
  units_per_load: string | number | null;
  delivery_fee: boolean | null;
  plan_symbol: string | null;
  item_symbol: string | null;
  description: string | null;
  is_wall_assembly: boolean | null;
  price_per_face_ft: string | number | null;
  price_per_linear_ft: string | number | null;
}

// Columns to request from Supabase, in a stable order.
export const CATALOG_ITEM_COLUMNS =
  "id, name, category, unit, unit_price, is_assembly, takeoff_unit, coverage_rate, " +
  "round_to, units_per_load, delivery_fee, plan_symbol, item_symbol, description, " +
  "is_wall_assembly, price_per_face_ft, price_per_linear_ft";

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Build the camelCase frontend item from a DB row. Optional fields are omitted
// (rather than set to null/false) so the object matches the historical jsonb
// shape exactly — the frontend keys much of its UI off `key != null` and
// truthiness, so absence must stay absence.
export function rowToItem(row: CatalogItemRow): CatalogItem {
  const item: CatalogItem = {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    unitPrice: num(row.unit_price) ?? 0,
  };

  if (row.is_assembly) item.isAssembly = true;
  if (row.takeoff_unit != null) item.takeoffUnit = row.takeoff_unit;
  if (row.coverage_rate != null) item.coverageRate = num(row.coverage_rate)!;
  if (row.round_to != null) item.roundTo = num(row.round_to)!;
  if (row.units_per_load != null) item.unitsPerLoad = num(row.units_per_load)!;
  if (row.delivery_fee) item.deliveryFee = true;
  if (row.plan_symbol != null) item.planSymbol = row.plan_symbol;
  if (row.item_symbol != null) item.itemSymbol = row.item_symbol;
  if (row.description != null) item.description = row.description;
  if (row.is_wall_assembly) item.isWallAssembly = true;
  if (row.price_per_face_ft != null) item.pricePerFaceFt = num(row.price_per_face_ft)!;
  if (row.price_per_linear_ft != null) item.pricePerLinearFt = num(row.price_per_linear_ft)!;

  return item;
}

// Build the DB row (typed columns only) to upsert from a camelCase frontend
// item. The app does not write `data`; the DB trigger derives it from these
// columns, so the app is fully independent of the jsonb column.
export function itemToRow(item: CatalogItem, sortOrder: number): Record<string, unknown> {
  return {
    id: item.id,
    sort_order: sortOrder,
    name: String(item.name ?? ""),
    category: String(item.category ?? ""),
    unit: String(item.unit ?? ""),
    unit_price: num(item.unitPrice) ?? 0,
    is_assembly: !!item.isAssembly,
    takeoff_unit: item.takeoffUnit ?? null,
    coverage_rate: num(item.coverageRate),
    round_to: num(item.roundTo),
    units_per_load: num(item.unitsPerLoad),
    delivery_fee: !!item.deliveryFee,
    plan_symbol: item.planSymbol ?? null,
    item_symbol: item.itemSymbol ?? null,
    description: item.description ?? null,
    is_wall_assembly: !!item.isWallAssembly,
    price_per_face_ft: num(item.pricePerFaceFt),
    price_per_linear_ft: num(item.pricePerLinearFt),
    updated_at: new Date().toISOString(),
  };
}
