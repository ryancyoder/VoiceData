// Mapping between the assembly-kit tables and the camelCase kit shape the
// estimator frontend uses. Kits used to live entirely in an `assembly_kits.data`
// jsonb blob; each kit now has typed parent columns, and its nested line items
// live in the `assembly_kit_items` child table (the source of truth). The app
// reads and writes only the columns/child rows. The legacy `data` jsonb is a
// DB-maintained derived copy (kept in sync by triggers) retained as a backup;
// the app never writes it.

export interface KitItem {
  catalogId?: string;
  name: string;
  category?: string;
  unit?: string;
  unitPrice?: number;
  notes?: string;
  isAssembly?: boolean;
  takeoffUnit?: string;
  coverageRate?: number;
  roundTo?: number;
  unitsPerLoad?: number;
  deliveryFee?: boolean;
  isWallAssembly?: boolean;
  pricePerFaceFt?: number;
  pricePerLinearFt?: number;
  [key: string]: unknown;
}

export interface Kit {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  color?: string | null;
  takeoffUnit?: string | null;
  items: KitItem[];
  [key: string]: unknown;
}

export interface KitRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  takeoff_unit: string | null;
  created_at: string;
}

export interface KitItemRow {
  id: string;
  kit_id: string;
  sort_order: number;
  catalog_id: string | null;
  name: string;
  category: string | null;
  unit: string | null;
  unit_price: string | number | null;
  notes: string | null;
  is_assembly: boolean | null;
  takeoff_unit: string | null;
  coverage_rate: string | number | null;
  round_to: string | number | null;
  units_per_load: string | number | null;
  delivery_fee: boolean | null;
  is_wall_assembly: boolean | null;
  price_per_face_ft: string | number | null;
  price_per_linear_ft: string | number | null;
}

export const KIT_COLUMNS = "id, name, description, color, takeoff_unit, created_at";

export const KIT_ITEM_COLUMNS =
  "id, kit_id, sort_order, catalog_id, name, category, unit, unit_price, notes, " +
  "is_assembly, takeoff_unit, coverage_rate, round_to, units_per_load, delivery_fee, " +
  "is_wall_assembly, price_per_face_ft, price_per_linear_ft";

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Reproduce the item shape saveKit() builds: core fields always, assembly and
// wall-assembly fields only when their flag is set, deliveryFee only alongside
// unitsPerLoad. Null columns are omitted so the object matches the historical blob.
function itemRowToKitItem(r: KitItemRow): KitItem {
  const item: KitItem = {
    catalogId: r.catalog_id ?? undefined,
    name: r.name,
    category: r.category ?? undefined,
    unit: r.unit ?? undefined,
    unitPrice: num(r.unit_price) ?? 0,
    notes: r.notes ?? "",
  };

  if (r.is_assembly) {
    item.isAssembly = true;
    if (r.takeoff_unit != null) item.takeoffUnit = r.takeoff_unit;
    if (r.coverage_rate != null) item.coverageRate = num(r.coverage_rate)!;
    if (r.round_to != null) item.roundTo = num(r.round_to)!;
    if (r.units_per_load != null) {
      item.unitsPerLoad = num(r.units_per_load)!;
      item.deliveryFee = r.delivery_fee ?? true;
    }
  }

  if (r.is_wall_assembly) {
    item.isWallAssembly = true;
    if (r.price_per_face_ft != null) item.pricePerFaceFt = num(r.price_per_face_ft)!;
    if (r.price_per_linear_ft != null) item.pricePerLinearFt = num(r.price_per_linear_ft)!;
  }

  return item;
}

export function rowToKit(kit: KitRow, itemRows: KitItemRow[]): Kit {
  const items = itemRows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(itemRowToKitItem);

  return {
    id: kit.id,
    name: kit.name,
    description: kit.description ?? "",
    createdAt: kit.created_at,
    color: kit.color ?? null,
    takeoffUnit: kit.takeoff_unit ?? null,
    items,
  };
}

// Parent columns for insert/update. `data` is intentionally omitted — the DB
// trigger derives it from these columns plus the child rows.
export function kitToParentRow(kit: Kit): Record<string, unknown> {
  return {
    id: kit.id,
    name: String(kit.name ?? ""),
    description: kit.description ?? "",
    color: kit.color ?? null,
    takeoff_unit: kit.takeoffUnit ?? null,
    created_at: kit.createdAt ?? new Date().toISOString(),
  };
}

export function kitItemToRow(item: KitItem, kitId: string, sortOrder: number): Record<string, unknown> {
  return {
    kit_id: kitId,
    sort_order: sortOrder,
    catalog_id: item.catalogId ?? null,
    name: String(item.name ?? ""),
    category: item.category ?? null,
    unit: item.unit ?? null,
    unit_price: num(item.unitPrice) ?? 0,
    notes: item.notes ?? "",
    is_assembly: !!item.isAssembly,
    takeoff_unit: item.takeoffUnit ?? null,
    coverage_rate: num(item.coverageRate),
    round_to: num(item.roundTo),
    units_per_load: num(item.unitsPerLoad),
    delivery_fee: item.deliveryFee == null ? null : !!item.deliveryFee,
    is_wall_assembly: !!item.isWallAssembly,
    price_per_face_ft: num(item.pricePerFaceFt),
    price_per_linear_ft: num(item.pricePerLinearFt),
  };
}
