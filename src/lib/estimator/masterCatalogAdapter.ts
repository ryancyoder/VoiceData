// Adapter: reads the normalized master catalog (materials / applications /
// assemblies / equipment) and emits the exact camelCase shapes the estimator
// UI already consumes — CatalogItem[] and Kit[] — so the proven UI can run
// unchanged against the new source. This is the read side only.

import { supabase } from "@/lib/supabaseClient";
import type { CatalogItem } from "./catalogItemColumns";
import type { Kit, KitItem } from "./assemblyKitColumns";

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Normalize the YAML/DB unit vocabulary to the estimator's display units.
const UNIT_MAP: Record<string, string> = {
  cubic_yard: "cu yd",
  sq_ft: "sq ft",
  ln_ft: "ln ft",
  linear_ft: "ln ft",
  face_ft: "face ft",
  piece: "ea",
};
const unit = (u: string | null): string => (u ? UNIT_MAP[u] ?? u : "");
const takeoff = (u: string | null): string | undefined => (u ? UNIT_MAP[u] ?? u : undefined);

// The estimator's quantity math always divides (takeoff / coverageRate). A
// "multiply" application (french drain: units per linear foot) is expressed to
// the estimator as the reciprocal so its divide gives the same result.
function coverageForEstimator(rate: number | null, method: string): number | undefined {
  if (rate == null) return undefined;
  return method === "multiply" ? 1 / rate : rate;
}

interface MaterialRow {
  id: string;
  material_name: string;
  category: string;
  unit: string;
  cost_per_unit: string | number | null;
  catalog_category: string | null;
  plan_symbol: string | null;
  item_symbol: string | null;
  delivery_fee: boolean | null;
  units_per_load: string | number | null;
  sort_order: number;
}
interface ApplicationRow {
  id: string;
  material_id: string;
  coverage_unit: string | null;
  coverage_rate: string | number | null;
  coverage_method: string;
  catalog_category: string | null;
  round_to: string | number | null;
  display_name: string | null;
  standalone: boolean;
}
interface EquipmentRow {
  id: string;
  equipment_name: string;
  category: string;
  unit: string;
  cost_per_unit: string | number | null;
  sort_order: number;
}
interface AssemblyRow {
  id: string;
  name: string;
  unit_of_work: string;
  sort_order: number;
}
interface RoleRow {
  assembly_id: string;
  application_id: string | null;
  sort_order: number;
}

const MATERIAL_COLS =
  "id, material_name, category, unit, cost_per_unit, catalog_category, plan_symbol, item_symbol, delivery_fee, units_per_load, sort_order";
const APPLICATION_COLS =
  "id, material_id, coverage_unit, coverage_rate, coverage_method, catalog_category, round_to, display_name, standalone";

// A catalog item derived from an application (a coverage-driven takeoff item).
function itemFromApplication(app: ApplicationRow, mat: MaterialRow): CatalogItem {
  const item: CatalogItem = {
    id: app.id,
    name: app.display_name ?? mat.material_name,
    category: app.catalog_category ?? mat.catalog_category ?? mat.category,
    unit: unit(mat.unit),
    unitPrice: num(mat.cost_per_unit) ?? 0,
    isAssembly: true,
  };
  const t = takeoff(app.coverage_unit);
  if (t) item.takeoffUnit = t;
  const cov = coverageForEstimator(num(app.coverage_rate), app.coverage_method);
  if (cov != null) item.coverageRate = cov;
  if (app.round_to != null) item.roundTo = num(app.round_to)!;
  if (mat.units_per_load != null) item.unitsPerLoad = num(mat.units_per_load)!;
  if (mat.delivery_fee) item.deliveryFee = true;
  return item;
}

// A catalog item for a directly-placed material (plants, lighting, labor,
// drainage parts) — no coverage; the estimator sizes it by unit or count.
function itemFromMaterial(mat: MaterialRow): CatalogItem {
  const item: CatalogItem = {
    id: mat.id,
    name: mat.material_name,
    category: mat.catalog_category ?? mat.category,
    unit: unit(mat.unit),
    unitPrice: num(mat.cost_per_unit) ?? 0,
  };
  if (mat.plan_symbol != null) item.planSymbol = mat.plan_symbol;
  if (mat.item_symbol != null) item.itemSymbol = mat.item_symbol;
  return item;
}

function itemFromEquipment(eq: EquipmentRow): CatalogItem {
  return {
    id: eq.id,
    name: eq.equipment_name,
    category: eq.category === "large_equipment" ? "heavy_equipment" : "small_equipment",
    unit: eq.unit,
    unitPrice: num(eq.cost_per_unit) ?? 0,
  };
}

// The full catalog as CatalogItem[]: standalone applications + direct materials
// + equipment. Delivery rate comes from estimator_settings (shared with the
// legacy endpoint).
export async function getMasterCatalog(): Promise<{ items: CatalogItem[]; deliveryRate: number }> {
  const [matsRes, appsRes, eqRes, settingsRes] = await Promise.all([
    supabase.from("materials").select(MATERIAL_COLS).order("sort_order", { ascending: true }),
    supabase.from("applications").select(APPLICATION_COLS),
    supabase.from("equipment").select("id, equipment_name, category, unit, cost_per_unit, sort_order").order("sort_order", { ascending: true }),
    supabase.from("estimator_settings").select("delivery_rate").eq("id", 1).maybeSingle(),
  ]);
  if (matsRes.error) throw new Error(matsRes.error.message);
  if (appsRes.error) throw new Error(appsRes.error.message);
  if (eqRes.error) throw new Error(eqRes.error.message);

  const mats = (matsRes.data ?? []) as MaterialRow[];
  const apps = (appsRes.data ?? []) as ApplicationRow[];
  const equipment = (eqRes.data ?? []) as EquipmentRow[];

  const matById = new Map(mats.map((m) => [m.id, m]));
  const materialsWithApp = new Set(apps.map((a) => a.material_id));

  const items: CatalogItem[] = [];
  // Coverage items (from standalone applications).
  for (const app of apps) {
    if (!app.standalone) continue;
    const mat = matById.get(app.material_id);
    if (mat) items.push(itemFromApplication(app, mat));
  }
  // Direct items (materials that aren't consumed only through an application).
  for (const mat of mats) {
    if (!materialsWithApp.has(mat.id)) items.push(itemFromMaterial(mat));
  }
  // Equipment.
  for (const eq of equipment) items.push(itemFromEquipment(eq));

  const deliveryRate = Number(settingsRes.data?.delivery_rate ?? 80);
  return { items, deliveryRate };
}

// Assemblies as Kits: each assembly's application-linked roles become kit line
// items. Assemblies with no priced roles (planting, outcropping) are omitted.
export async function getMasterKits(): Promise<Kit[]> {
  const [asmRes, rolesRes, appsRes, matsRes] = await Promise.all([
    supabase.from("assemblies").select("id, name, unit_of_work, sort_order").order("sort_order", { ascending: true }),
    supabase.from("assembly_roles").select("assembly_id, application_id, sort_order").order("sort_order", { ascending: true }),
    supabase.from("applications").select(APPLICATION_COLS),
    supabase.from("materials").select(MATERIAL_COLS),
  ]);
  if (asmRes.error) throw new Error(asmRes.error.message);
  if (rolesRes.error) throw new Error(rolesRes.error.message);
  if (appsRes.error) throw new Error(appsRes.error.message);
  if (matsRes.error) throw new Error(matsRes.error.message);

  const assemblies = (asmRes.data ?? []) as AssemblyRow[];
  const roles = (rolesRes.data ?? []) as RoleRow[];
  const appById = new Map(((appsRes.data ?? []) as ApplicationRow[]).map((a) => [a.id, a]));
  const matById = new Map(((matsRes.data ?? []) as MaterialRow[]).map((m) => [m.id, m]));

  const rolesByAssembly = new Map<string, RoleRow[]>();
  for (const r of roles) {
    (rolesByAssembly.get(r.assembly_id) ?? rolesByAssembly.set(r.assembly_id, []).get(r.assembly_id)!).push(r);
  }

  const kits: Kit[] = [];
  for (const asm of assemblies) {
    const asmRoles = (rolesByAssembly.get(asm.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const items: KitItem[] = [];
    for (const role of asmRoles) {
      if (!role.application_id) continue;
      const app = appById.get(role.application_id);
      if (!app) continue;
      const mat = matById.get(app.material_id);
      if (!mat) continue;
      const ci = itemFromApplication(app, mat);
      const kitItem: KitItem = {
        catalogId: ci.id,
        name: ci.name,
        category: ci.category,
        unit: ci.unit,
        unitPrice: ci.unitPrice,
        notes: "",
        isAssembly: true,
      };
      if (ci.takeoffUnit != null) kitItem.takeoffUnit = ci.takeoffUnit as string;
      if (ci.coverageRate != null) kitItem.coverageRate = ci.coverageRate as number;
      if (ci.roundTo != null) kitItem.roundTo = ci.roundTo as number;
      if (ci.unitsPerLoad != null) {
        kitItem.unitsPerLoad = ci.unitsPerLoad as number;
        kitItem.deliveryFee = !!ci.deliveryFee;
      }
      items.push(kitItem);
    }
    if (items.length === 0) continue; // skip planting/outcropping (no priced roles)
    kits.push({
      id: asm.id,
      name: asm.name,
      description: "",
      color: null,
      takeoffUnit: asm.unit_of_work === "sq_ft" ? "area" : asm.unit_of_work === "ln_ft" ? "linear" : null,
      items,
    });
  }
  return kits;
}
