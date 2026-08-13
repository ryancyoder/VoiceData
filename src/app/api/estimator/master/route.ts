import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { masterPhotoUrl, photoKey } from "@/lib/estimator/masterPhotos";

// The normalized "master catalog" as its own entities — the read/write surface
// for the richer-model editor (distinct from the flat catalog-v2 adapter used
// by the legacy UI). GET returns materials (with their applications nested),
// equipment, and assemblies (with their roles + equipment nested). PUT saves
// edits to materials, applications, equipment, and assemblies.

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const MATERIAL_COLS =
  "id, material_name, aspire_name, category, catalog_category, unit, cost_per_unit, delivery_fee, units_per_load, plan_symbol, item_symbol, round_to, is_wall_assembly, price_per_face_ft, price_per_linear_ft, sort_order";
const APPLICATION_COLS =
  "id, material_id, application, coverage_unit, coverage_rate, coverage_method, catalog_category, round_to, display_name, standalone";
const EQUIPMENT_COLS = "id, equipment_name, category, unit, cost_per_unit, sort_order";

export async function GET() {
  const [matsRes, appsRes, eqRes, asmRes, rolesRes, asmEqRes, photosRes, seqRes, defRes, wfRes, stepsRes] = await Promise.all([
    supabase.from("materials").select(MATERIAL_COLS).order("sort_order", { ascending: true }),
    supabase.from("applications").select(APPLICATION_COLS),
    supabase.from("equipment").select(EQUIPMENT_COLS).order("sort_order", { ascending: true }),
    supabase.from("assemblies").select("id, name, operation_stage, unit_of_work, equipment_required, sort_order").order("sort_order", { ascending: true }),
    supabase.from("assembly_roles").select("assembly_id, role_key, application_id, required, sort_order").order("sort_order", { ascending: true }),
    supabase.from("assembly_equipment").select("assembly_id, equipment_id, sort_order").order("sort_order", { ascending: true }),
    supabase.from("master_photos").select("id, entity_type, entity_id, storage_path, is_cover").order("is_cover", { ascending: false }).order("created_at", { ascending: true }),
    supabase.from("sequence_stages").select("name, sort_order").order("sort_order", { ascending: true }),
    supabase.from("stage_defaults").select("stage, unit_of_work, units_per_man_hr, cost_per_unit_baseline"),
    supabase.from("stage_workflows").select("stage, description"),
    supabase.from("stage_workflow_steps").select("stage, step, sort_order").order("sort_order", { ascending: true }),
  ]);
  for (const r of [matsRes, appsRes, eqRes, asmRes, rolesRes, asmEqRes, photosRes, seqRes, defRes, wfRes, stepsRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  // Photos grouped by "entityType:entityId", cover first (from the order above).
  const photos: Record<string, { id: string; url: string; is_cover: boolean }[]> = {};
  for (const p of photosRes.data ?? []) {
    const key = photoKey(p.entity_type, p.entity_id);
    (photos[key] ??= []).push({ id: p.id, url: masterPhotoUrl(p.storage_path), is_cover: p.is_cover });
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
  const equipByAssembly = new Map<string, unknown[]>();
  for (const e of asmEqRes.data ?? []) {
    (equipByAssembly.get(e.assembly_id) ?? equipByAssembly.set(e.assembly_id, []).get(e.assembly_id)!).push(e);
  }
  const assemblies = (asmRes.data ?? []).map((a) => ({
    ...a,
    roles: rolesByAssembly.get(a.id) ?? [],
    equipment: equipByAssembly.get(a.id) ?? [],
  }));

  // Production phases: the canonical ordered sequence, each with its per-stage
  // defaults (unit of work, production rate, baseline cost), optional workflow
  // description, and ordered workflow steps.
  const defByStage = new Map((defRes.data ?? []).map((d) => [d.stage, d]));
  const wfByStage = new Map((wfRes.data ?? []).map((w) => [w.stage, w.description]));
  const stepsByStage = new Map<string, { step: string; sort_order: number }[]>();
  for (const s of stepsRes.data ?? []) {
    (stepsByStage.get(s.stage) ?? stepsByStage.set(s.stage, []).get(s.stage)!).push({ step: s.step, sort_order: s.sort_order });
  }
  const phases = (seqRes.data ?? []).map((s) => {
    const def = defByStage.get(s.name);
    return {
      name: s.name,
      sort_order: s.sort_order,
      unit_of_work: def?.unit_of_work ?? null,
      units_per_man_hr: def?.units_per_man_hr ?? null,
      cost_per_unit_baseline: def?.cost_per_unit_baseline ?? null,
      description: wfByStage.get(s.name) ?? null,
      steps: stepsByStage.get(s.name) ?? [],
    };
  });

  return NextResponse.json({ materials, equipment: eqRes.data ?? [], assemblies, phases, photos });
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
  aspire_name?: string | null;
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
interface RoleInput {
  role_key?: string;
  application_id?: string | null;
  required?: boolean;
}
interface AssemblyEquipInput {
  equipment_id?: string;
}
interface AssemblyInput {
  id: string;
  name?: string;
  operation_stage?: string;
  unit_of_work?: string;
  equipment_required?: boolean;
  roles?: RoleInput[];
  equipment?: AssemblyEquipInput[];
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    materials?: MaterialInput[];
    equipment?: EquipmentInput[];
    assemblies?: AssemblyInput[];
    deletedMaterialIds?: string[];
    deletedApplicationIds?: string[];
    deletedEquipmentIds?: string[];
    deletedAssemblyIds?: string[];
  };
  const materials = body.materials ?? [];
  const equipment = body.equipment ?? [];
  // Assemblies are only touched when the key is present, so a materials-only
  // save never wipes them (the whole-collection replace is opt-in).
  const hasAssemblies = Array.isArray(body.assemblies);
  const assemblies = body.assemblies ?? [];
  const delMaterialIds = (body.deletedMaterialIds ?? []).filter((s) => typeof s === "string" && s);
  const delAppIds = (body.deletedApplicationIds ?? []).filter((s) => typeof s === "string" && s);
  const delEquipmentIds = (body.deletedEquipmentIds ?? []).filter((s) => typeof s === "string" && s);
  const delAssemblyIds = (body.deletedAssemblyIds ?? []).filter((s) => typeof s === "string" && s);
  const now = new Date().toISOString();

  if (materials.some((m) => !m || typeof m.id !== "string" || !m.id)) {
    return NextResponse.json({ error: "every material needs a string id" }, { status: 400 });
  }
  const badAsm = assemblies.find(
    (a) => !a || typeof a.id !== "string" || !a.id || !String(a.name ?? "").trim() || !String(a.operation_stage ?? "").trim() || !String(a.unit_of_work ?? "").trim()
  );
  if (badAsm) {
    return NextResponse.json({ error: "every assembly needs an id, name, operation stage, and unit of work" }, { status: 400 });
  }

  const materialRows = materials.map((m, i) => ({
    id: m.id,
    material_name: String(m.material_name ?? ""),
    aspire_name: m.aspire_name?.trim() ? m.aspire_name.trim() : null,
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

  const assemblyRows = assemblies.map((a, i) => ({
    id: a.id,
    name: String(a.name ?? ""),
    operation_stage: String(a.operation_stage ?? ""),
    unit_of_work: String(a.unit_of_work ?? ""),
    equipment_required: !!a.equipment_required,
    sort_order: i,
    updated_at: now,
  }));
  // Child rows carry no id — assembly_roles/assembly_equipment use IDENTITY
  // ALWAYS keys, so they are replaced (delete-then-insert) per save rather than
  // upserted. role_key is required; an empty one falls back to its application.
  const roleRows = assemblies.flatMap((a) =>
    (a.roles ?? [])
      .map((r, j) => ({
        assembly_id: a.id,
        role_key: String(r.role_key ?? "").trim() || String(r.application_id ?? "").trim(),
        application_id: r.application_id ? String(r.application_id) : null,
        required: !!r.required,
        sort_order: j,
      }))
      .filter((r) => r.role_key)
  );
  const asmEquipRows = assemblies.flatMap((a) =>
    (a.equipment ?? [])
      .map((e, j) => ({ assembly_id: a.id, equipment_id: String(e.equipment_id ?? "").trim(), sort_order: j }))
      .filter((e) => e.equipment_id)
  );

  // ── Deletes, in FK-safe order ──────────────────────────────────────────
  // assembly_roles/assembly_equipment reference applications/equipment with
  // RESTRICT, so those child links must be cleared before their targets can be
  // removed. Assemblies being replaced have their children rebuilt below, so we
  // drop the old child rows up front — this both frees RESTRICT targets and
  // implements the replace. Deleted assemblies cascade their children.
  if (delAssemblyIds.length) {
    const { error } = await supabase.from("assemblies").delete().in("id", delAssemblyIds);
    if (error) return NextResponse.json({ error: `delete assemblies: ${error.message}` }, { status: 409 });
  }
  if (hasAssemblies && assemblyRows.length) {
    const ids = assemblyRows.map((a) => a.id);
    const delRoles = await supabase.from("assembly_roles").delete().in("assembly_id", ids);
    if (delRoles.error) return NextResponse.json({ error: `clear roles: ${delRoles.error.message}` }, { status: 500 });
    const delEq = await supabase.from("assembly_equipment").delete().in("assembly_id", ids);
    if (delEq.error) return NextResponse.json({ error: `clear assembly equipment: ${delEq.error.message}` }, { status: 500 });
  }
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

  // ── Upserts: parents before the rows that FK them ──────────────────────
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
  if (assemblyRows.length) {
    const { error } = await supabase.from("assemblies").upsert(assemblyRows);
    if (error) return NextResponse.json({ error: `assemblies: ${error.message}` }, { status: 500 });
  }
  // Child rows reference the just-upserted assemblies / applications / equipment.
  if (roleRows.length) {
    const { error } = await supabase.from("assembly_roles").insert(roleRows);
    if (error) return NextResponse.json({ error: `assembly roles: ${error.message}` }, { status: 500 });
  }
  if (asmEquipRows.length) {
    const { error } = await supabase.from("assembly_equipment").insert(asmEquipRows);
    if (error) return NextResponse.json({ error: `assembly equipment: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    materials: materialRows.length,
    applications: appRows.length,
    equipment: equipmentRows.length,
    assemblies: assemblyRows.length,
    roles: roleRows.length,
  });
}
