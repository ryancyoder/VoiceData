"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── The richer, normalized catalog editor ────────────────────────────────
// A native editor for the master model (materials → their applications,
// equipment, and read-only assemblies) that reads and writes the normalized
// Supabase tables directly via /api/estimator/master. This is the write
// surface the legacy flat catalog editor can't safely be — materials are
// shared across contexts, coverage lives per-application, and deletes are
// FK-constrained. Built to run side-by-side with the legacy Catalog page.

interface Application {
  id: string;
  material_id?: string;
  application?: string;
  display_name?: string | null;
  coverage_unit?: string | null;
  coverage_rate?: number | string | null;
  coverage_method?: string;
  catalog_category?: string | null;
  round_to?: number | string | null;
  standalone?: boolean;
}

interface Material {
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
  applications: Application[];
}

interface Equipment {
  id: string;
  equipment_name?: string;
  category?: string;
  unit?: string;
  cost_per_unit?: number | string | null;
}

interface Role {
  role_key?: string;
  application_id?: string | null;
  required?: boolean;
}
interface Assembly {
  id: string;
  name?: string;
  operation_stage?: string | null;
  unit_of_work?: string | null;
  equipment_required?: boolean | null;
  roles: Role[];
}

const MATERIAL_CATEGORIES = [
  "base_material", "bedding_material", "drainage", "edging", "erosion_control",
  "fabric", "hardscape", "labor", "lawn", "lighting", "patio", "plants", "seed",
  "soil", "soil_amendment", "standard_materials", "surface_material",
];
const CATALOG_CATEGORIES = ["bulk_materials", "standard_materials", "lawn", "edging", "hardscape", "drainage", "lighting", "plants", "labor"];
const MATERIAL_UNITS = ["cubic_yard", "sq_ft", "ln ft", "ea", "piece", "bag", "pail", "pallet", "roll", "ton", "day"];
const COVERAGE_UNITS = ["sq_ft", "ln_ft", "linear_ft", "face_ft"];
const COVERAGE_METHODS = ["divide", "multiply"];
const EQUIPMENT_CATEGORIES = ["small_equipment", "large_equipment"];

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function slugId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function MasterCatalogClient() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Ids removed this session, sent to the server on Save so the normalized rows
  // are actually deleted (the upsert alone never removes rows).
  const [deletedMaterialIds, setDeletedMaterialIds] = useState<string[]>([]);
  const [deletedApplicationIds, setDeletedApplicationIds] = useState<string[]>([]);
  const [deletedEquipmentIds, setDeletedEquipmentIds] = useState<string[]>([]);
  // Ids created this session (never sent as deletes if removed before saving).
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    return fetch("/api/estimator/master")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load master catalog"))))
      .then((data) => {
        setMaterials(
          (Array.isArray(data.materials) ? data.materials : []).map((m: Material) => ({
            ...m,
            applications: Array.isArray(m.applications) ? m.applications : [],
          }))
        );
        setEquipment(Array.isArray(data.equipment) ? data.equipment : []);
        setAssemblies(
          (Array.isArray(data.assemblies) ? data.assemblies : []).map((a: Assembly) => ({
            ...a,
            roles: Array.isArray(a.roles) ? a.roles : [],
          }))
        );
        setDeletedMaterialIds([]);
        setDeletedApplicationIds([]);
        setDeletedEquipmentIds([]);
        setNewIds(new Set());
        setDirty(false);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function markDirty() {
    setDirty(true);
    setSaveState("idle");
  }

  const byCategory = useMemo(() => {
    const map = new Map<string, Material[]>();
    for (const m of materials) {
      const cat = m.category || "uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(m);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [materials]);

  // ── Material edits ──────────────────────────────────────────────────────
  function updateMaterial(id: string, field: keyof Material, value: unknown) {
    setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
    markDirty();
  }
  function addMaterial(category: string) {
    const id = slugId("new_material");
    setMaterials((prev) => [
      ...prev,
      { id, material_name: "New material", category, unit: "ea", cost_per_unit: 0, delivery_fee: false, applications: [] },
    ]);
    setNewIds((prev) => new Set(prev).add(id));
    setExpanded((prev) => new Set(prev).add(id));
    markDirty();
  }
  function removeMaterial(m: Material) {
    setMaterials((prev) => prev.filter((x) => x.id !== m.id));
    // Its applications must be deleted too (FK RESTRICT), unless brand-new.
    setDeletedApplicationIds((prev) => [
      ...prev,
      ...m.applications.filter((a) => !newIds.has(a.id)).map((a) => a.id),
    ]);
    if (!newIds.has(m.id)) setDeletedMaterialIds((prev) => [...prev, m.id]);
    markDirty();
  }

  // ── Application edits ───────────────────────────────────────────────────
  function updateApp(materialId: string, appId: string, field: keyof Application, value: unknown) {
    setMaterials((prev) =>
      prev.map((m) =>
        m.id === materialId
          ? { ...m, applications: m.applications.map((a) => (a.id === appId ? { ...a, [field]: value } : a)) }
          : m
      )
    );
    markDirty();
  }
  function addApp(materialId: string) {
    const id = slugId("new_app");
    setMaterials((prev) =>
      prev.map((m) =>
        m.id === materialId
          ? {
              ...m,
              applications: [
                ...m.applications,
                { id, application: "", display_name: "", coverage_unit: "sq_ft", coverage_rate: 1, coverage_method: "divide", standalone: true },
              ],
            }
          : m
      )
    );
    setNewIds((prev) => new Set(prev).add(id));
    markDirty();
  }
  function removeApp(materialId: string, app: Application) {
    setMaterials((prev) =>
      prev.map((m) => (m.id === materialId ? { ...m, applications: m.applications.filter((a) => a.id !== app.id) } : m))
    );
    if (!newIds.has(app.id)) setDeletedApplicationIds((prev) => [...prev, app.id]);
    markDirty();
  }

  // ── Equipment edits ─────────────────────────────────────────────────────
  function updateEquipment(id: string, field: keyof Equipment, value: unknown) {
    setEquipment((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
    markDirty();
  }
  function addEquipment() {
    const id = slugId("new_equipment");
    setEquipment((prev) => [...prev, { id, equipment_name: "New equipment", category: "small_equipment", unit: "day", cost_per_unit: 0 }]);
    setNewIds((prev) => new Set(prev).add(id));
    markDirty();
  }
  function removeEquipment(e: Equipment) {
    setEquipment((prev) => prev.filter((x) => x.id !== e.id));
    if (!newIds.has(e.id)) setDeletedEquipmentIds((prev) => [...prev, e.id]);
    markDirty();
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/estimator/master", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materials, equipment, deletedMaterialIds, deletedApplicationIds, deletedEquipmentIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "save failed");
      }
      await load();
      setSaveState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setSaveState("error");
    }
  }

  const numInput = "w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900";
  const textInput = "w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  const selectInput = "rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  const materialCount = materials.length;
  const appCount = materials.reduce((n, m) => n + m.applications.length, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Master Catalog</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {loading
              ? "Loading…"
              : `${materialCount} materials · ${appCount} applications · ${equipment.length} equipment · ${assemblies.length} assemblies`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!locked && dirty && <span className="text-xs font-medium text-amber-600 dark:text-amber-500">Unsaved changes</span>}
          {saveState === "saved" && <span className="text-xs font-medium text-green-600 dark:text-green-500">Saved</span>}
          {saveState === "error" && <span className="text-xs font-medium text-red-600 dark:text-red-500">Save failed</span>}
          {!locked && (
            <button
              onClick={handleSave}
              disabled={!dirty || saveState === "saving"}
              className="rounded-full bg-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
            >
              {saveState === "saving" ? "Saving…" : "Save changes"}
            </button>
          )}
          <button
            onClick={() => setLocked((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              locked
                ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                : "border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-400"
            }`}
            title={locked ? "Unlock to edit" : "Lock to prevent edits"}
          >
            {locked ? "🔒 Locked" : "🔓 Editing"}
          </button>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
        This edits the normalized master model directly. The legacy{" "}
        <a href="/catalog" className="underline">Catalog</a> page reads a flattened view of the same data — use both
        side-by-side while the richer model is proven out.
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {locked && (
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
          Locked. Click <span className="font-semibold">🔒 Locked</span> to edit — nothing is saved until you press{" "}
          <span className="font-semibold">Save changes</span>.
        </p>
      )}

      {/* ── Materials ──────────────────────────────────────────────────── */}
      {!loading &&
        byCategory.map(([cat, catMats]) => (
          <section key={cat} className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {cat.replace(/_/g, " ")} <span className="ml-1 font-normal text-zinc-400">({catMats.length})</span>
              </h2>
              {!locked && (
                <button
                  onClick={() => addMaterial(cat)}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 dark:text-green-500 dark:hover:bg-green-950"
                >
                  + Add material
                </button>
              )}
            </div>

            <div className="space-y-2">
              {catMats.map((m) => {
                const isOpen = expanded.has(m.id);
                return (
                  <div key={m.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                    {/* Material header */}
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <button
                        onClick={() => toggleExpand(m.id)}
                        className="shrink-0 rounded px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                        title={isOpen ? "Collapse" : "Expand"}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                      {locked ? (
                        <span className="min-w-40 flex-1 font-medium text-zinc-800 dark:text-zinc-100">{m.material_name}</span>
                      ) : (
                        <input
                          className={`${textInput} min-w-40 flex-1`}
                          value={m.material_name ?? ""}
                          onChange={(e) => updateMaterial(m.id, "material_name", e.target.value)}
                        />
                      )}
                      <span className="text-xs text-zinc-400">unit</span>
                      {locked ? (
                        <span className="text-sm text-zinc-600 dark:text-zinc-300">{m.unit}</span>
                      ) : (
                        <select className={selectInput} value={m.unit ?? ""} onChange={(e) => updateMaterial(m.id, "unit", e.target.value)}>
                          {MATERIAL_UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                          {m.unit && !MATERIAL_UNITS.includes(m.unit) && <option value={m.unit}>{m.unit}</option>}
                        </select>
                      )}
                      <span className="text-xs text-zinc-400">cost</span>
                      {locked ? (
                        <span className="tabular-nums text-zinc-800 dark:text-zinc-100">{money(toNum(m.cost_per_unit))}</span>
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          className={`${numInput} max-w-28`}
                          value={m.cost_per_unit ?? 0}
                          onChange={(e) => updateMaterial(m.id, "cost_per_unit", e.target.value === "" ? 0 : Number(e.target.value))}
                        />
                      )}
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {m.applications.length} app{m.applications.length === 1 ? "" : "s"}
                      </span>
                      {!locked && (
                        <button
                          onClick={() => removeMaterial(m)}
                          className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                          title="Remove material"
                          aria-label="Remove material"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Material details + applications */}
                    {isOpen && (
                      <div className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
                        {/* Material property grid */}
                        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                          <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            Category
                            {locked ? (
                              <span className="text-sm text-zinc-700 dark:text-zinc-200">{m.category}</span>
                            ) : (
                              <select className={selectInput} value={m.category ?? ""} onChange={(e) => updateMaterial(m.id, "category", e.target.value)}>
                                {MATERIAL_CATEGORIES.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                                {m.category && !MATERIAL_CATEGORIES.includes(m.category) && <option value={m.category}>{m.category}</option>}
                              </select>
                            )}
                          </label>
                          <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            Estimator category
                            {locked ? (
                              <span className="text-sm text-zinc-700 dark:text-zinc-200">{m.catalog_category ?? "—"}</span>
                            ) : (
                              <select
                                className={selectInput}
                                value={m.catalog_category ?? ""}
                                onChange={(e) => updateMaterial(m.id, "catalog_category", e.target.value || null)}
                              >
                                <option value="">— none —</option>
                                {CATALOG_CATEGORIES.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                                {m.catalog_category && !CATALOG_CATEGORIES.includes(m.catalog_category) && (
                                  <option value={m.catalog_category}>{m.catalog_category}</option>
                                )}
                              </select>
                            )}
                          </label>
                          <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            Round to
                            {locked ? (
                              <span className="text-sm text-zinc-700 dark:text-zinc-200">{m.round_to ?? "—"}</span>
                            ) : (
                              <input
                                type="number"
                                step="0.25"
                                className={numInput}
                                value={m.round_to ?? ""}
                                onChange={(e) => updateMaterial(m.id, "round_to", e.target.value === "" ? null : Number(e.target.value))}
                              />
                            )}
                          </label>
                          <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            Plan symbol
                            {locked ? (
                              <span className="text-sm text-zinc-700 dark:text-zinc-200">{m.plan_symbol ?? "—"}</span>
                            ) : (
                              <input className={textInput} value={m.plan_symbol ?? ""} onChange={(e) => updateMaterial(m.id, "plan_symbol", e.target.value || null)} />
                            )}
                          </label>
                          <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            Item symbol
                            {locked ? (
                              <span className="text-sm text-zinc-700 dark:text-zinc-200">{m.item_symbol ?? "—"}</span>
                            ) : (
                              <input className={textInput} value={m.item_symbol ?? ""} onChange={(e) => updateMaterial(m.id, "item_symbol", e.target.value || null)} />
                            )}
                          </label>
                          <div className="flex items-end gap-4">
                            <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                              <input
                                type="checkbox"
                                checked={!!m.delivery_fee}
                                disabled={locked}
                                onChange={(e) => updateMaterial(m.id, "delivery_fee", e.target.checked)}
                              />
                              Delivery fee
                            </label>
                            {m.delivery_fee && (
                              <label className="flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                Units/load
                                {locked ? (
                                  <span className="text-sm text-zinc-700 dark:text-zinc-200">{m.units_per_load ?? "—"}</span>
                                ) : (
                                  <input
                                    type="number"
                                    step="1"
                                    className={`${numInput} max-w-20`}
                                    value={m.units_per_load ?? ""}
                                    onChange={(e) => updateMaterial(m.id, "units_per_load", e.target.value === "" ? null : Number(e.target.value))}
                                  />
                                )}
                              </label>
                            )}
                          </div>
                        </div>

                        {/* Applications */}
                        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                          <div className="flex items-center justify-between border-b border-zinc-100 px-2.5 py-1.5 dark:border-zinc-800">
                            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Applications</span>
                            {!locked && (
                              <button
                                onClick={() => addApp(m.id)}
                                className="rounded px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-50 dark:text-green-500 dark:hover:bg-green-950"
                              >
                                + Add application
                              </button>
                            )}
                          </div>
                          {m.applications.length === 0 ? (
                            <p className="px-2.5 py-2 text-xs text-zinc-400">
                              No applications — this material is used directly (its cost/unit is the price).
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[760px] border-collapse text-sm">
                                <thead>
                                  <tr className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-400 dark:bg-zinc-900">
                                    <th className="px-2 py-1.5 font-medium">Display name</th>
                                    <th className="px-2 py-1.5 font-medium">Key</th>
                                    <th className="px-2 py-1.5 text-right font-medium">Coverage rate</th>
                                    <th className="px-2 py-1.5 font-medium">Method</th>
                                    <th className="px-2 py-1.5 font-medium">Cov. unit</th>
                                    <th className="px-2 py-1.5 text-right font-medium">Round to</th>
                                    <th className="px-2 py-1.5 text-center font-medium">Standalone</th>
                                    {!locked && <th className="px-2 py-1.5" />}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                  {m.applications.map((a) => (
                                    <tr key={a.id} className="text-zinc-800 dark:text-zinc-200">
                                      <td className="px-2 py-1">
                                        {locked ? (
                                          (a.display_name || a.application || "—")
                                        ) : (
                                          <input className={textInput} value={a.display_name ?? ""} onChange={(e) => updateApp(m.id, a.id, "display_name", e.target.value)} />
                                        )}
                                      </td>
                                      <td className="px-2 py-1">
                                        {locked ? (
                                          <code className="text-xs text-zinc-500">{a.application}</code>
                                        ) : (
                                          <input className={`${textInput} font-mono text-xs`} value={a.application ?? ""} onChange={(e) => updateApp(m.id, a.id, "application", e.target.value)} />
                                        )}
                                      </td>
                                      <td className="px-2 py-1 text-right tabular-nums">
                                        {locked ? (
                                          (a.coverage_rate ?? "—")
                                        ) : (
                                          <input
                                            type="number"
                                            step="0.01"
                                            className={`${numInput} max-w-24`}
                                            value={a.coverage_rate ?? ""}
                                            onChange={(e) => updateApp(m.id, a.id, "coverage_rate", e.target.value === "" ? null : Number(e.target.value))}
                                          />
                                        )}
                                      </td>
                                      <td className="px-2 py-1">
                                        {locked ? (
                                          a.coverage_method ?? "divide"
                                        ) : (
                                          <select className={selectInput} value={a.coverage_method ?? "divide"} onChange={(e) => updateApp(m.id, a.id, "coverage_method", e.target.value)}>
                                            {COVERAGE_METHODS.map((c) => (
                                              <option key={c} value={c}>{c}</option>
                                            ))}
                                          </select>
                                        )}
                                      </td>
                                      <td className="px-2 py-1">
                                        {locked ? (
                                          (a.coverage_unit ?? "—")
                                        ) : (
                                          <select className={selectInput} value={a.coverage_unit ?? ""} onChange={(e) => updateApp(m.id, a.id, "coverage_unit", e.target.value || null)}>
                                            <option value="">—</option>
                                            {COVERAGE_UNITS.map((c) => (
                                              <option key={c} value={c}>{c}</option>
                                            ))}
                                            {a.coverage_unit && !COVERAGE_UNITS.includes(a.coverage_unit) && <option value={a.coverage_unit}>{a.coverage_unit}</option>}
                                          </select>
                                        )}
                                      </td>
                                      <td className="px-2 py-1 text-right tabular-nums">
                                        {locked ? (
                                          (a.round_to ?? "—")
                                        ) : (
                                          <input
                                            type="number"
                                            step="0.25"
                                            className={`${numInput} max-w-20`}
                                            value={a.round_to ?? ""}
                                            onChange={(e) => updateApp(m.id, a.id, "round_to", e.target.value === "" ? null : Number(e.target.value))}
                                          />
                                        )}
                                      </td>
                                      <td className="px-2 py-1 text-center">
                                        <input
                                          type="checkbox"
                                          checked={a.standalone !== false}
                                          disabled={locked}
                                          onChange={(e) => updateApp(m.id, a.id, "standalone", e.target.checked)}
                                        />
                                      </td>
                                      {!locked && (
                                        <td className="px-2 py-1 text-right">
                                          <button
                                            onClick={() => removeApp(m.id, a)}
                                            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                                            title="Remove application"
                                            aria-label="Remove application"
                                          >
                                            ✕
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

      {/* ── Equipment ──────────────────────────────────────────────────── */}
      {!loading && (
        <section className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Equipment <span className="ml-1 font-normal text-zinc-400">({equipment.length})</span>
            </h2>
            {!locked && (
              <button
                onClick={addEquipment}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 dark:text-green-500 dark:hover:bg-green-950"
              >
                + Add equipment
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Unit</th>
                  <th className="px-3 py-2 text-right font-medium">Cost/unit</th>
                  {!locked && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {equipment.map((e) => (
                  <tr key={e.id} className="text-zinc-800 dark:text-zinc-200">
                    <td className="px-3 py-1.5">
                      {locked ? (
                        e.equipment_name
                      ) : (
                        <input className={textInput} value={e.equipment_name ?? ""} onChange={(ev) => updateEquipment(e.id, "equipment_name", ev.target.value)} />
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {locked ? (
                        e.category
                      ) : (
                        <select className={selectInput} value={e.category ?? "small_equipment"} onChange={(ev) => updateEquipment(e.id, "category", ev.target.value)}>
                          {EQUIPMENT_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {locked ? (
                        e.unit
                      ) : (
                        <input className={`${textInput} max-w-24`} value={e.unit ?? ""} onChange={(ev) => updateEquipment(e.id, "unit", ev.target.value)} />
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {locked ? (
                        money(toNum(e.cost_per_unit))
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          className={`${numInput} max-w-28`}
                          value={e.cost_per_unit ?? 0}
                          onChange={(ev) => updateEquipment(e.id, "cost_per_unit", ev.target.value === "" ? 0 : Number(ev.target.value))}
                        />
                      )}
                    </td>
                    {!locked && (
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => removeEquipment(e)}
                          className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                          title="Remove equipment"
                          aria-label="Remove equipment"
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {equipment.length === 0 && (
                  <tr>
                    <td colSpan={locked ? 4 : 5} className="px-3 py-3 text-center text-sm text-zinc-400">No equipment.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Assemblies (read-only) ─────────────────────────────────────── */}
      {!loading && assemblies.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Assemblies <span className="ml-1 font-normal text-zinc-400">({assemblies.length} · read-only)</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {assemblies.map((a) => (
              <div key={a.id} className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">{a.name}</span>
                  {a.operation_stage && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {a.operation_stage}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {a.unit_of_work ? `per ${a.unit_of_work}` : ""}
                  {a.equipment_required ? " · equipment required" : ""}
                  {` · ${a.roles.length} role${a.roles.length === 1 ? "" : "s"}`}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Assemblies and their roles are shown for reference. Editing them comes in a later step.
          </p>
        </section>
      )}
    </main>
  );
}
