import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// The normalized "master catalog" as its own entities — the read/write surface
// for the richer-model editor (distinct from the flat catalog-v2 adapter used
// by the legacy UI). GET returns materials (with their applications nested),
// equipment, and assemblies (read-only for now). PUT saves edits to materials,
// applications, and equipment.

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const MATERIAL_COLS =
  "id, material_name, category, catalog_category, unit, cost_per_unit, delivery_fee, units_per_load, plan_symbol, item_symbol, round_to, is_wall_assembly, price_per_face_ft, price_per_linear_ft, sort_order";
const APPLICATION_COLS =
  "id, material_id, application, coverage_unit, coverage_rate, coverage_method, catalog_category, round_to, display_name, standalone";
const EQUIPMENT_COLS = "id, equipment_name, category, unit, cost_per_unit, sort_order";

export async function GET() {
  const [matsRes, appsRes, eqRes, asmRes, rolesRes] = await Promise.all([
    supabase.from("materials").select(MATERIAL_COLS).order("sort_order", { ascending: true }),
    supabase.from("applications").select(APPLICATION_COLS),
    supabase.from("equipment").select(EQUIPMENT_COLS).order("sort_order", { ascending: true }),
    supabase.from("assemblies").select("id, name, operation_stage, unit_of_work, equipment_required, sort_order").order("sort_order", { ascending: true }),
    supabase.from("assembly_roles").select("assembly_id, role_key, application_id, required, sort_order").order("sort_order", { ascending: true }),
  ]);
  for (const r of [matsRes, appsRes, eqRes, asmRes, rolesRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const appsByMaterial = new Map<string, unknown[]>();
  for (const a of appsRes.data ?? []) {
    (appsByMaterial.get(a.material_id) ?? appsByMaterial.set(a.material_id, []).get(a.material_id)!).push(a);
  }
  const materials = (matsRes.data ?? []).map((m) => ({ ...m, applications: appsByMaterial.get(m.id) ?? [] }));

  const rolesByAssembly = new Map<string, unknown[]>();
  for (const r of rolesRes.data ?? []) {
    (rolesByAssembly.get(r.assembly_id) ?? rolesByAssembly.set(r.assembly_id, []).get(r.assembly_id)!).push(r);
  }
  const assemblies = (asmRes.data ?? []).map((a) => ({ ...a, roles: rolesByAssembly.get(a.id) ?? [] }));

  return NextResponse.json({ materials, equipment: eqRes.data ?? [], assemblies });
}

interface AppInput {
  id: string;
  material_id?: string;
  application?: string;
  coverage_unit?: string | null;
  coverage_rate?: number | string | null;
  coverage_method?: string;
  catalog_category?: string | null;
  round_to?: number | string | null;
  display_name?: string | null;
  standalone?: boolean;
}
interface MaterialInput {
  id: string;
  material_name?: string;
  category?: string;
  catalog_category?: string | null;
  unit?: string;
  cost_per_unit?: number | string | null;
  delivery_fee?: boolean;
  units_per_load?: number | string | null;
  plan_symbol?: string | null;
  item_symbol?: string | null;
  round_to?: number | string | null;
  applications?: AppInput[];
}
interface EquipmentInput {
  id: string;
  equipment_name?: string;
  category?: string;
  unit?: string;
  cost_per_unit?: number | string | null;
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    materials?: MaterialInput[];
    equipment?: EquipmentInput[];
    deletedMaterialIds?: string[];
    deletedApplicationIds?: string[];
    deletedEquipmentIds?: string[];
  };
  const materials = body.materials ?? [];
  const equipment = body.equipment ?? [];
  const delMaterialIds = (body.deletedMaterialIds ?? []).filter((s) => typeof s === "string" && s);
  const delAppIds = (body.deletedApplicationIds ?? []).filter((s) => typeof s === "string" && s);
  const delEquipmentIds = (body.deletedEquipmentIds ?? []).filter((s) => typeof s === "string" && s);
  const now = new Date().toISOString();

  if (materials.some((m) => !m || typeof m.id !== "string" || !m.id)) {
    return NextResponse.json({ error: "every material needs a string id" }, { status: 400 });
  }

  const materialRows = materials.map((m, i) => ({
    id: m.id,
    material_name: String(m.material_name ?? ""),
    category: String(m.category ?? ""),
    catalog_category: m.catalog_category ?? null,
    unit: String(m.unit ?? ""),
    cost_per_unit: num(m.cost_per_unit) ?? 0,
    delivery_fee: !!m.delivery_fee,
    units_per_load: num(m.units_per_load),
    plan_symbol: m.plan_symbol ?? null,
    item_symbol: m.item_symbol ?? null,
    round_to: num(m.round_to),
    sort_order: i,
    updated_at: now,
  }));

  const appRows = materials.flatMap((m) =>
    (m.applications ?? []).map((a) => ({
      id: a.id,
      material_id: m.id,
      application: String(a.application ?? ""),
      coverage_unit: a.coverage_unit ?? null,
      coverage_rate: num(a.coverage_rate),
      coverage_method: a.coverage_method === "multiply" ? "multiply" : "divide",
      catalog_category: a.catalog_category ?? null,
      round_to: num(a.round_to),
      display_name: a.display_name ?? null,
      standalone: a.standalone !== false,
      updated_at: now,
    }))
  );

  const equipmentRows = equipment.map((e, i) => ({
    id: e.id,
    equipment_name: String(e.equipment_name ?? ""),
    category: String(e.category ?? "small_equipment"),
    unit: String(e.unit ?? "day"),
    cost_per_unit: num(e.cost_per_unit) ?? 0,
    sort_order: i,
    updated_at: now,
  }));

  // Deletes first, in FK-safe order: applications RESTRICT their material, and
  // assembly_roles RESTRICT the applications/equipment they reference — so an
  // application (or equipment) still used by an assembly can't be removed here,
  // and that constraint violation surfaces to the editor rather than silently
  // dropping data. Applications go before materials so a removed material's
  // rows clear first.
  if (delAppIds.length) {
    const { error } = await supabase.from("applications").delete().in("id", delAppIds);
    if (error) return NextResponse.json({ error: `delete applications: ${error.message}` }, { status: 409 });
  }
  if (delMaterialIds.length) {
    const { error } = await supabase.from("materials").delete().in("id", delMaterialIds);
    if (error) return NextResponse.json({ error: `delete materials: ${error.message}` }, { status: 409 });
  }
  if (delEquipmentIds.length) {
    const { error } = await supabase.from("equipment").delete().in("id", delEquipmentIds);
    if (error) return NextResponse.json({ error: `delete equipment: ${error.message}` }, { status: 409 });
  }

  // Upsert materials first (applications FK them), then applications, equipment.
  if (materialRows.length) {
    const { error } = await supabase.from("materials").upsert(materialRows);
    if (error) return NextResponse.json({ error: `materials: ${error.message}` }, { status: 500 });
  }
  if (appRows.length) {
    const { error } = await supabase.from("applications").upsert(appRows);
    if (error) return NextResponse.json({ error: `applications: ${error.message}` }, { status: 500 });
  }
  if (equipmentRows.length) {
    const { error } = await supabase.from("equipment").upsert(equipmentRows);
    if (error) return NextResponse.json({ error: `equipment: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, materials: materialRows.length, applications: appRows.length, equipment: equipmentRows.length });
}
