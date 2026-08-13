"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Master Catalog gallery ────────────────────────────────────────────────
// A photo-forward, browsable view of the normalized master model. Instead of
// opening a modal, clicking a tile *drills*: the clicked entity becomes an
// inline header (info + photos) and the grid below filters to its related
// entities — a material shows the assemblies that use it; an assembly shows
// its role materials and equipment; equipment shows the assemblies that need
// it. A breadcrumb walks the trail back. Photos are stored per entity via
// /api/estimator/master/photos.

interface Photo { id: string; url: string; is_cover: boolean }
interface Application {
  id: string; application?: string; display_name?: string | null;
  coverage_unit?: string | null; coverage_rate?: number | string | null;
  coverage_method?: string; standalone?: boolean;
}
interface Material {
  id: string; material_name?: string; category?: string; catalog_category?: string | null;
  unit?: string; cost_per_unit?: number | string | null; plan_symbol?: string | null;
  item_symbol?: string | null; applications: Application[];
}
interface Equipment { id: string; equipment_name?: string; category?: string; unit?: string; cost_per_unit?: number | string | null }
interface Role { role_key?: string; application_id?: string | null; required?: boolean }
interface AssemblyEquip { equipment_id?: string }
interface Assembly {
  id: string; name?: string; operation_stage?: string | null; unit_of_work?: string | null;
  equipment_required?: boolean | null; roles: Role[]; equipment: AssemblyEquip[];
}
interface Phase {
  name: string; sort_order: number; unit_of_work?: string | null;
  units_per_man_hr?: number | string | null; cost_per_unit_baseline?: number | string | null;
  description?: string | null; steps: { step: string; sort_order: number }[];
}

type EntityType = "material" | "assembly" | "equipment" | "stage";
type Ref = { type: EntityType; id: string };

const TABS: { key: EntityType; label: string; icon: string }[] = [
  { key: "stage", label: "Phases", icon: "🏗️" },
  { key: "material", label: "Materials", icon: "📦" },
  { key: "assembly", label: "Assemblies", icon: "🧱" },
  { key: "equipment", label: "Equipment", icon: "🚜" },
];
const FALLBACK_ICON: Record<EntityType, string> = { material: "📦", assembly: "🧱", equipment: "🚜", stage: "🏗️" };
const PLURAL: Record<EntityType, string> = { material: "materials", assembly: "assemblies", equipment: "equipment", stage: "phases" };

function money(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function key(type: string, id: string) { return `${type}:${id}`; }
function titleCase(s?: string | null) { return (s ?? "").replace(/_/g, " "); }

export function MasterGalleryClient({ viewToggle }: { viewToggle?: React.ReactNode }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<EntityType>("stage");
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<Ref[]>([]);
  const [locked, setLocked] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [bigTiles, setBigTiles] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/estimator/master")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load master catalog"))))
      .then((data) => {
        setMaterials((Array.isArray(data.materials) ? data.materials : []).map((m: Material) => ({ ...m, applications: m.applications ?? [] })));
        setEquipment(Array.isArray(data.equipment) ? data.equipment : []);
        setAssemblies((Array.isArray(data.assemblies) ? data.assemblies : []).map((a: Assembly) => ({ ...a, roles: a.roles ?? [], equipment: a.equipment ?? [] })));
        setPhases((Array.isArray(data.phases) ? data.phases : []).map((p: Phase) => ({ ...p, steps: p.steps ?? [] })));
        setPhotos(data.photos ?? {});
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Lookups & relationship graph ────────────────────────────────────────
  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const equipmentById = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);
  const assemblyById = useMemo(() => new Map(assemblies.map((a) => [a.id, a])), [assemblies]);
  const appIndex = useMemo(() => {
    const m = new Map<string, { app: Application; material: Material }>();
    for (const mat of materials) for (const a of mat.applications) m.set(a.id, { app: a, material: mat });
    return m;
  }, [materials]);
  const assembliesByApp = useMemo(() => {
    const m = new Map<string, Assembly[]>();
    for (const a of assemblies) for (const r of a.roles) if (r.application_id) (m.get(r.application_id) ?? m.set(r.application_id, []).get(r.application_id)!).push(a);
    return m;
  }, [assemblies]);
  const assembliesByEquip = useMemo(() => {
    const m = new Map<string, Assembly[]>();
    for (const a of assemblies) for (const e of a.equipment) if (e.equipment_id) (m.get(e.equipment_id) ?? m.set(e.equipment_id, []).get(e.equipment_id)!).push(a);
    return m;
  }, [assemblies]);
  const phaseByName = useMemo(() => new Map(phases.map((p) => [p.name, p])), [phases]);
  const assembliesByStage = useMemo(() => {
    const m = new Map<string, Assembly[]>();
    for (const a of assemblies) if (a.operation_stage) (m.get(a.operation_stage) ?? m.set(a.operation_stage, []).get(a.operation_stage)!).push(a);
    return m;
  }, [assemblies]);

  const assembliesForMaterial = useCallback((mat: Material): Assembly[] => {
    const seen = new Set<string>(); const out: Assembly[] = [];
    for (const app of mat.applications) for (const a of assembliesByApp.get(app.id) ?? []) if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
    return out;
  }, [assembliesByApp]);
  const materialsForAssembly = useCallback((a: Assembly): Material[] => {
    const seen = new Set<string>(); const out: Material[] = [];
    for (const r of a.roles) { if (!r.application_id) continue; const hit = appIndex.get(r.application_id); if (hit && !seen.has(hit.material.id)) { seen.add(hit.material.id); out.push(hit.material); } }
    return out;
  }, [appIndex]);
  const equipmentForAssembly = useCallback((a: Assembly): Equipment[] => {
    const seen = new Set<string>(); const out: Equipment[] = [];
    for (const e of a.equipment) { if (!e.equipment_id) continue; const eq = equipmentById.get(e.equipment_id); if (eq && !seen.has(eq.id)) { seen.add(eq.id); out.push(eq); } }
    return out;
  }, [equipmentById]);

  const coverOf = useCallback((type: string, id: string): Photo | null => {
    const list = photos[key(type, id)] ?? [];
    return list.find((p) => p.is_cover) ?? list[0] ?? null;
  }, [photos]);

  // ── Photo management ────────────────────────────────────────────────────
  const uploadPhoto = useCallback(async (type: EntityType, id: string, file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("entity_type", type); fd.append("entity_id", id);
      const res = await fetch("/api/estimator/master/photos", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "upload failed");
      const { photo } = await res.json();
      setPhotos((prev) => ({ ...prev, [key(type, id)]: [...(prev[key(type, id)] ?? []), photo] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  }, []);

  async function deletePhoto(type: EntityType, id: string, photoId: string) {
    const k = key(type, id);
    const prevList = photos[k] ?? [];
    const removed = prevList.find((p) => p.id === photoId);
    const remaining = prevList.filter((p) => p.id !== photoId);
    if (removed?.is_cover && remaining.length > 0) remaining[0] = { ...remaining[0], is_cover: true };
    setPhotos((prev) => ({ ...prev, [k]: remaining }));
    try {
      const res = await fetch(`/api/estimator/master/photos/${photoId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch { setError("Could not delete photo."); load(); }
  }

  async function setCover(type: EntityType, id: string, photoId: string) {
    const k = key(type, id);
    setPhotos((prev) => ({ ...prev, [k]: (prev[k] ?? []).map((p) => ({ ...p, is_cover: p.id === photoId })) }));
    try {
      const res = await fetch(`/api/estimator/master/photos/${photoId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_cover: true }) });
      if (!res.ok) throw new Error("set cover failed");
    } catch { setError("Could not set cover photo."); load(); }
  }

  // ── Navigation ──────────────────────────────────────────────────────────
  const focus = stack[stack.length - 1] ?? null;
  const drillTo = (type: EntityType, id: string) => setStack((s) => [...s, { type, id }]);
  const gotoDepth = (depth: number) => setStack((s) => s.slice(0, depth)); // depth 0 = top-level
  const switchTab = (t: EntityType) => { setStack([]); setTab(t); };

  // ── Tile metadata ───────────────────────────────────────────────────────
  function tileFor(type: EntityType, id: string): { name: string; sub: string; fallback: string; badge?: string } | null {
    if (type === "material") {
      const m = materialById.get(id); if (!m) return null;
      return { name: m.material_name ?? id, sub: `${titleCase(m.category)} · ${money(m.cost_per_unit)}/${m.unit}`, fallback: m.plan_symbol || m.item_symbol || "📦", badge: m.applications.length ? `${m.applications.length} app${m.applications.length === 1 ? "" : "s"}` : undefined };
    }
    if (type === "assembly") {
      const a = assemblyById.get(id); if (!a) return null;
      return { name: a.name ?? id, sub: `${titleCase(a.operation_stage)} · ${a.roles.length} role${a.roles.length === 1 ? "" : "s"}`, fallback: "🧱" };
    }
    if (type === "stage") {
      const p = phaseByName.get(id); if (!p) return null;
      const rate = p.units_per_man_hr != null ? `${p.units_per_man_hr} ${p.unit_of_work ?? "u"}/hr` : (p.unit_of_work ?? "—");
      const n = (assembliesByStage.get(id) ?? []).length;
      return { name: titleCase(p.name), sub: rate, fallback: "🏗️", badge: n ? `${n} assembly${n === 1 ? "" : "s"}` : undefined };
    }
    const e = equipmentById.get(id); if (!e) return null;
    return { name: e.equipment_name ?? id, sub: `${titleCase(e.category)} · ${money(e.cost_per_unit)}/${e.unit}`, fallback: "🚜" };
  }

  const tileClass = "group relative aspect-square w-full cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";

  function Tile({ type, id }: { type: EntityType; id: string }) {
    const meta = tileFor(type, id);
    if (!meta) return null;
    const cover = coverOf(type, id);
    const count = (photos[key(type, id)] ?? []).length;
    return (
      <button onClick={() => drillTo(type, id)} className={tileClass}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl opacity-40">{meta.fallback}</div>
        )}
        {count > 1 && <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">{count}</span>}
        {meta.badge && <span className="absolute left-1 top-1 rounded-full bg-emerald-600/90 px-1.5 text-[10px] font-medium text-white">{meta.badge}</span>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-left">
          <p className="truncate text-xs font-semibold text-white">{meta.name}</p>
          <p className="truncate text-[10px] text-white/70">{meta.sub}</p>
        </div>
      </button>
    );
  }

  function Grid({ children }: { children: React.ReactNode }) {
    // "Larger" drops the column count ~1/3 at each breakpoint, so tiles render
    // roughly 50% bigger.
    const cols = bigTiles
      ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8";
    return <ul className={`grid gap-4 ${cols}`}>{children}</ul>;
  }
  const li = (type: EntityType, id: string) => <li key={`${type}:${id}`}><Tile type={type} id={id} /></li>;

  // Top-level search over the active tab
  const q = query.trim().toLowerCase();
  const topLevel = useMemo(() => {
    if (tab === "stage") return phases.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => p.name);
    if (tab === "material") return materials.filter((m) => !q || (m.material_name ?? "").toLowerCase().includes(q) || (m.category ?? "").toLowerCase().includes(q)).map((m) => m.id);
    if (tab === "equipment") return equipment.filter((e) => !q || (e.equipment_name ?? "").toLowerCase().includes(q) || (e.category ?? "").toLowerCase().includes(q)).map((e) => e.id);
    return assemblies.filter((a) => !q || (a.name ?? "").toLowerCase().includes(q) || (a.operation_stage ?? "").toLowerCase().includes(q)).map((a) => a.id);
  }, [tab, q, phases, materials, equipment, assemblies]);

  // Focused entity → its related sections
  const focusMeta = focus ? tileFor(focus.type, focus.id) : null;
  let relatedSections: { label: string; type: EntityType; ids: string[]; empty: string }[] = [];
  let focusFields: { label: string; value: string }[] = [];
  let focusExtra: React.ReactNode = null;
  if (focus?.type === "stage") {
    const p = phaseByName.get(focus.id);
    if (p) {
      focusFields = [
        { label: "Sequence", value: `#${p.sort_order} of ${phases.length}` },
        { label: "Unit of work", value: p.unit_of_work ?? "—" },
        { label: "Production rate", value: p.units_per_man_hr != null ? `${p.units_per_man_hr} ${p.unit_of_work ?? "u"} / man-hr` : "—" },
        ...(p.cost_per_unit_baseline != null ? [{ label: "Baseline cost", value: money(p.cost_per_unit_baseline) }] : []),
        ...(p.description ? [{ label: "Workflow", value: p.description }] : []),
      ];
      if (p.steps.length > 0) {
        focusExtra = (
          <div className="mt-3">
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Workflow steps</h4>
            <ol className="flex flex-wrap items-center gap-1.5">
              {p.steps.map((s, i) => (
                <span key={`${s.step}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">→</span>}
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{titleCase(s.step)}</span>
                </span>
              ))}
            </ol>
          </div>
        );
      }
      relatedSections = [{ label: "Assemblies in this phase", type: "assembly", ids: (assembliesByStage.get(p.name) ?? []).map((a) => a.id), empty: "No assemblies in this phase yet." }];
    }
  } else if (focus?.type === "material") {
    const m = materialById.get(focus.id);
    if (m) {
      focusFields = [
        { label: "Category", value: titleCase(m.category) || "—" },
        { label: "Unit", value: m.unit ?? "—" },
        { label: "Cost/unit", value: money(m.cost_per_unit) },
        ...(m.catalog_category ? [{ label: "Estimator cat.", value: m.catalog_category }] : []),
        ...(m.plan_symbol ? [{ label: "Plan symbol", value: m.plan_symbol }] : []),
        ...(m.applications.length ? [{ label: "Applications", value: m.applications.map((a) => a.display_name || a.application).filter(Boolean).join(", ") }] : []),
      ];
      relatedSections = [{ label: "Assemblies using this material", type: "assembly", ids: assembliesForMaterial(m).map((a) => a.id), empty: "Not used by any assembly." }];
    }
  } else if (focus?.type === "equipment") {
    const e = equipmentById.get(focus.id);
    if (e) {
      focusFields = [
        { label: "Class", value: titleCase(e.category) || "—" },
        { label: "Unit", value: e.unit ?? "—" },
        { label: "Cost/unit", value: money(e.cost_per_unit) },
      ];
      relatedSections = [{ label: "Assemblies using this equipment", type: "assembly", ids: (assembliesByEquip.get(e.id) ?? []).map((a) => a.id), empty: "Not used by any assembly." }];
    }
  } else if (focus?.type === "assembly") {
    const a = assemblyById.get(focus.id);
    if (a) {
      focusFields = [
        { label: "Unit of work", value: a.unit_of_work ?? "—" },
        { label: "Equipment", value: a.equipment_required ? "required" : "—" },
      ];
      if (a.operation_stage && phaseByName.has(a.operation_stage)) {
        const stageName = a.operation_stage;
        focusExtra = (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-[11px] uppercase tracking-wide text-zinc-400">Phase</span>
            <button
              onClick={() => drillTo("stage", stageName)}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
            >
              🏗️ {titleCase(stageName)} →
            </button>
          </div>
        );
      }
      relatedSections = [
        { label: "Materials in this assembly", type: "material", ids: materialsForAssembly(a).map((m) => m.id), empty: "No materials." },
        { label: "Equipment in this assembly", type: "equipment", ids: equipmentForAssembly(a).map((e) => e.id), empty: "No equipment." },
      ];
    }
  }

  return (
    <main className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Master Catalog</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {loading ? "Loading…" : `${materials.length} materials · ${assemblies.length} assemblies · ${equipment.length} equipment`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {viewToggle}
          <button
            onClick={() => setBigTiles((v) => !v)}
            aria-pressed={bigTiles}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title={bigTiles ? "Smaller tiles" : "Larger tiles"}
          >
            {bigTiles ? "⊟ Smaller" : "⊞ Larger"}
          </button>
          <button
            onClick={() => setLocked((v) => !v)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              locked ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                     : "border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-400"}`}
            title={locked ? "Unlock to manage photos" : "Lock"}
          >
            {locked ? "🔒 Locked" : "🔓 Photos"}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}

      {/* Breadcrumb (only while drilled in) */}
      {focus && (
        <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          <button onClick={() => gotoDepth(0)} className="rounded px-1.5 py-0.5 hover:text-zinc-800 dark:hover:text-zinc-100">All {PLURAL[tab]}</button>
          {stack.map((r, i) => {
            const meta = tileFor(r.type, r.id);
            return (
              <span key={`${r.type}:${r.id}:${i}`} className="flex items-center gap-1">
                <span className="text-zinc-300 dark:text-zinc-600">/</span>
                {i === stack.length - 1 ? (
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">{meta?.name}</span>
                ) : (
                  <button onClick={() => gotoDepth(i + 1)} className="rounded px-1.5 py-0.5 hover:text-zinc-800 dark:hover:text-zinc-100">{meta?.name}</button>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {/* Top-level: tabs + search + all tiles */}
      {!focus && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
              {TABS.map((t) => (
                <button key={t.key} onClick={() => switchTab(t.key)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    tab === t.key ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"}`}>
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="w-48 rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </div>
          {!loading && (
            <Grid>
              {topLevel.map((id) => li(tab, id))}
              {topLevel.length === 0 && <li className="col-span-full py-10 text-center text-sm text-zinc-400">Nothing matches.</li>}
            </Grid>
          )}
        </>
      )}

      {/* Focused: inline header (info + photos) + related tiles */}
      {focus && focusMeta && (
        <>
          <section className="mb-6 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <button onClick={() => gotoDepth(stack.length - 1)} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Back">←</button>
              <span className="text-2xl">{FALLBACK_ICON[focus.type]}</span>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{focusMeta.name}</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{focusMeta.sub}</p>
              </div>
            </div>

            {focusFields.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                {focusFields.map((f) => (
                  <div key={f.label}>
                    <dt className="text-[11px] uppercase tracking-wide text-zinc-400">{f.label}</dt>
                    <dd className="text-zinc-800 dark:text-zinc-100">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {focusExtra}

            <div className="mt-4">
              <PhotoStrip
                photos={photos[key(focus.type, focus.id)] ?? []}
                locked={locked}
                uploading={uploading}
                onUpload={(file) => uploadPhoto(focus.type, focus.id, file)}
                onDelete={(pid) => deletePhoto(focus.type, focus.id, pid)}
                onSetCover={(pid) => setCover(focus.type, focus.id, pid)}
              />
            </div>
          </section>

          {relatedSections.map((sec) => (
            <div key={sec.label} className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {sec.label} <span className="ml-1 font-normal text-zinc-400">({sec.ids.length})</span>
              </h3>
              {sec.ids.length === 0 ? (
                <p className="text-sm text-zinc-400">{sec.empty}</p>
              ) : (
                <Grid>{sec.ids.map((id) => li(sec.type, id))}</Grid>
              )}
            </div>
          ))}
        </>
      )}
    </main>
  );
}

function PhotoStrip({ photos, locked, uploading, onUpload, onDelete, onSetCover }: {
  photos: Photo[]; locked: boolean; uploading: boolean;
  onUpload: (f: File) => void; onDelete: (id: string) => void; onSetCover: (id: string) => void;
}) {
  const [pasteErr, setPasteErr] = useState<string | null>(null);

  async function handlePasteImage() {
    setPasteErr(null);
    try {
      if (!navigator.clipboard?.read) {
        setPasteErr("Clipboard paste isn't supported in this browser.");
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          const ext = (imgType.split("/")[1] || "png").replace("jpeg", "jpg");
          onUpload(new File([blob], `pasted-${Date.now()}.${ext}`, { type: imgType }));
          return;
        }
      }
      setPasteErr("No image found on the clipboard.");
    } catch {
      setPasteErr("Couldn't read the clipboard — check paste permission.");
    }
  }

  return (
    <div>
      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {photos.map((p) => (
            <div key={p.id} className="group relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="aspect-square w-full object-cover" />
              {p.is_cover && <span className="absolute left-1 top-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>}
              {!locked && (
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/50 p-1 opacity-0 transition group-hover:opacity-100">
                  {!p.is_cover && <button onClick={() => onSetCover(p.id)} className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-zinc-800">Cover</button>}
                  <button onClick={() => onDelete(p.id)} className="ml-auto rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-red-600">Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-zinc-50 py-6 text-center text-sm text-zinc-400 dark:bg-zinc-800">
          {locked ? "No photos yet." : "No photos yet — add one below."}
        </p>
      )}
      {!locked && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
            {uploading ? "Uploading…" : "+ Add photo"}
            <input type="file" accept="image/*" className="hidden" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
          </label>
          <button
            type="button"
            onClick={handlePasteImage}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
            title="Paste an image copied to your clipboard"
          >
            📋 Paste image
          </button>
          {pasteErr && <span className="text-xs text-red-500">{pasteErr}</span>}
        </div>
      )}
    </div>
  );
}
