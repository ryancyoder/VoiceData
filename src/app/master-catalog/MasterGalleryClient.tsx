"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Master Catalog gallery ────────────────────────────────────────────────
// A photo-forward, browsable view of the normalized master model — the
// gallery counterpart to the table editor, mirroring the Plant Reference
// gallery. Browse Materials / Assemblies / Equipment as cards, open one, and
// cross-navigate the relationships: a material links to its applications and
// the assemblies that use it; an assembly links to its role materials and its
// equipment; equipment links back to the assemblies that need it. Photos are
// stored per entity via /api/estimator/master/photos.

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

type EntityType = "material" | "assembly" | "equipment";
type Ref = { type: EntityType; id: string };

const TABS: { key: EntityType; label: string; icon: string; plural: string }[] = [
  { key: "material", label: "Materials", icon: "📦", plural: "materials" },
  { key: "assembly", label: "Assemblies", icon: "🧱", plural: "assemblies" },
  { key: "equipment", label: "Equipment", icon: "🚜", plural: "equipment" },
];

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
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<EntityType>("material");
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<Ref[]>([]);
  const [locked, setLocked] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/estimator/master")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load master catalog"))))
      .then((data) => {
        setMaterials((Array.isArray(data.materials) ? data.materials : []).map((m: Material) => ({ ...m, applications: m.applications ?? [] })));
        setEquipment(Array.isArray(data.equipment) ? data.equipment : []);
        setAssemblies((Array.isArray(data.assemblies) ? data.assemblies : []).map((a: Assembly) => ({ ...a, roles: a.roles ?? [], equipment: a.equipment ?? [] })));
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
  // application id -> { app, material }
  const appIndex = useMemo(() => {
    const m = new Map<string, { app: Application; material: Material }>();
    for (const mat of materials) for (const a of mat.applications) m.set(a.id, { app: a, material: mat });
    return m;
  }, [materials]);
  // application id -> assemblies that use it (via roles)
  const assembliesByApp = useMemo(() => {
    const m = new Map<string, Assembly[]>();
    for (const a of assemblies) for (const r of a.roles) if (r.application_id) (m.get(r.application_id) ?? m.set(r.application_id, []).get(r.application_id)!).push(a);
    return m;
  }, [assemblies]);
  // equipment id -> assemblies that use it
  const assembliesByEquip = useMemo(() => {
    const m = new Map<string, Assembly[]>();
    for (const a of assemblies) for (const e of a.equipment) if (e.equipment_id) (m.get(e.equipment_id) ?? m.set(e.equipment_id, []).get(e.equipment_id)!).push(a);
    return m;
  }, [assemblies]);
  function assembliesForMaterial(mat: Material): Assembly[] {
    const seen = new Set<string>(); const out: Assembly[] = [];
    for (const app of mat.applications) for (const a of assembliesByApp.get(app.id) ?? []) if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
    return out;
  }

  const coverOf = useCallback((type: string, id: string): Photo | null => {
    const list = photos[key(type, id)] ?? [];
    return list.find((p) => p.is_cover) ?? list[0] ?? null;
  }, [photos]);

  // ── Photo management ────────────────────────────────────────────────────
  const uploadPhoto = useCallback(async (type: EntityType, id: string, file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entity_type", type);
      fd.append("entity_id", id);
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
    } catch {
      setError("Could not delete photo.");
      load();
    }
  }

  async function setCover(type: EntityType, id: string, photoId: string) {
    const k = key(type, id);
    setPhotos((prev) => ({ ...prev, [k]: (prev[k] ?? []).map((p) => ({ ...p, is_cover: p.id === photoId })) }));
    try {
      const res = await fetch(`/api/estimator/master/photos/${photoId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_cover: true }),
      });
      if (!res.ok) throw new Error("set cover failed");
    } catch {
      setError("Could not set cover photo.");
      load();
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────
  const current = stack[stack.length - 1] ?? null;
  const open = (type: EntityType, id: string) => setStack((s) => [...s, { type, id }]);
  const back = () => setStack((s) => s.slice(0, -1));
  const close = () => setStack([]);

  // ── Filtered cards for the active tab ───────────────────────────────────
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (tab === "material") return materials.filter((m) => !q || (m.material_name ?? "").toLowerCase().includes(q) || (m.category ?? "").toLowerCase().includes(q));
    if (tab === "equipment") return equipment.filter((e) => !q || (e.equipment_name ?? "").toLowerCase().includes(q) || (e.category ?? "").toLowerCase().includes(q));
    return assemblies.filter((a) => !q || (a.name ?? "").toLowerCase().includes(q) || (a.operation_stage ?? "").toLowerCase().includes(q));
  }, [tab, q, materials, equipment, assemblies]);

  const tileClass = "group relative aspect-square cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";

  function Cover({ type, id, fallback }: { type: EntityType; id: string; fallback: string }) {
    const cover = coverOf(type, id);
    const count = (photos[key(type, id)] ?? []).length;
    return (
      <>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl opacity-40">{fallback}</div>
        )}
        {count > 1 && (
          <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">{count}</span>
        )}
      </>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
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
            onClick={() => setLocked((v) => !v)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              locked
                ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                : "border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-400"
            }`}
            title={locked ? "Unlock to manage photos" : "Lock"}
          >
            {locked ? "🔒 Locked" : "🔓 Photos"}
          </button>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-48 rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {/* Card grid */}
      {!loading && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {tab === "material" && (visible as Material[]).map((m) => (
            <li key={m.id}>
              <button onClick={() => open("material", m.id)} className={`${tileClass} w-full`}>
                <Cover type="material" id={m.id} fallback={m.plan_symbol || m.item_symbol || "📦"} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-left">
                  <p className="truncate text-xs font-semibold text-white">{m.material_name}</p>
                  <p className="truncate text-[10px] text-white/70">{titleCase(m.category)} · {money(m.cost_per_unit)}/{m.unit}</p>
                </div>
                {m.applications.length > 0 && (
                  <span className="absolute left-1 top-1 rounded-full bg-emerald-600/90 px-1.5 text-[10px] font-medium text-white">{m.applications.length} app{m.applications.length === 1 ? "" : "s"}</span>
                )}
              </button>
            </li>
          ))}
          {tab === "assembly" && (visible as Assembly[]).map((a) => (
            <li key={a.id}>
              <button onClick={() => open("assembly", a.id)} className={`${tileClass} w-full`}>
                <Cover type="assembly" id={a.id} fallback="🧱" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-left">
                  <p className="truncate text-xs font-semibold text-white">{a.name}</p>
                  <p className="truncate text-[10px] text-white/70">{titleCase(a.operation_stage)} · {a.roles.length} role{a.roles.length === 1 ? "" : "s"}</p>
                </div>
              </button>
            </li>
          ))}
          {tab === "equipment" && (visible as Equipment[]).map((e) => (
            <li key={e.id}>
              <button onClick={() => open("equipment", e.id)} className={`${tileClass} w-full`}>
                <Cover type="equipment" id={e.id} fallback="🚜" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-left">
                  <p className="truncate text-xs font-semibold text-white">{e.equipment_name}</p>
                  <p className="truncate text-[10px] text-white/70">{titleCase(e.category)} · {money(e.cost_per_unit)}/{e.unit}</p>
                </div>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="col-span-full py-10 text-center text-sm text-zinc-400">Nothing matches.</li>}
        </ul>
      )}

      {/* Detail modal */}
      {current && (
        <DetailModal
          refItem={current}
          canGoBack={stack.length > 1}
          onBack={back}
          onClose={close}
          onOpen={open}
          locked={locked}
          uploading={uploading}
          photos={photos[key(current.type, current.id)] ?? []}
          onUpload={(file) => uploadPhoto(current.type, current.id, file)}
          onDeletePhoto={(pid) => deletePhoto(current.type, current.id, pid)}
          onSetCover={(pid) => setCover(current.type, current.id, pid)}
          materialById={materialById}
          equipmentById={equipmentById}
          assemblyById={assemblyById}
          appIndex={appIndex}
          assembliesByApp={assembliesByApp}
          assembliesByEquip={assembliesByEquip}
          assembliesForMaterial={assembliesForMaterial}
          coverOf={coverOf}
        />
      )}
    </main>
  );
}

// ── Detail modal ────────────────────────────────────────────────────────────
function DetailModal(props: {
  refItem: Ref; canGoBack: boolean; onBack: () => void; onClose: () => void; onOpen: (t: EntityType, id: string) => void;
  locked: boolean; uploading: boolean; photos: Photo[];
  onUpload: (file: File) => void; onDeletePhoto: (id: string) => void; onSetCover: (id: string) => void;
  materialById: Map<string, Material>; equipmentById: Map<string, Equipment>; assemblyById: Map<string, Assembly>;
  appIndex: Map<string, { app: Application; material: Material }>;
  assembliesByApp: Map<string, Assembly[]>; assembliesByEquip: Map<string, Assembly[]>;
  assembliesForMaterial: (m: Material) => Assembly[]; coverOf: (t: string, id: string) => Photo | null;
}) {
  const { refItem, materialById, equipmentById, assemblyById, appIndex, assembliesByEquip, assembliesForMaterial, onOpen } = props;

  let title = "";
  let subtitle = "";
  let body: React.ReactNode = null;

  const linkChip = (t: EntityType, id: string, label: string, sub?: string) => (
    <button
      key={`${t}:${id}`}
      onClick={() => onOpen(t, id)}
      className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left hover:border-emerald-400 hover:bg-emerald-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-emerald-600 dark:hover:bg-emerald-950"
    >
      {props.coverOf(t, id) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={props.coverOf(t, id)!.url} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-zinc-100 text-sm dark:bg-zinc-700">{t === "equipment" ? "🚜" : t === "assembly" ? "🧱" : "📦"}</span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">{label}</span>
        {sub && <span className="block truncate text-[11px] text-zinc-400">{sub}</span>}
      </span>
    </button>
  );

  if (refItem.type === "material") {
    const m = materialById.get(refItem.id);
    if (m) {
      title = m.material_name ?? m.id;
      subtitle = `${titleCase(m.category)} · ${money(m.cost_per_unit)}/${m.unit}`;
      const usedIn = assembliesForMaterial(m);
      body = (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            <Field label="Unit" value={m.unit} />
            <Field label="Cost/unit" value={money(m.cost_per_unit)} />
            <Field label="Estimator cat." value={m.catalog_category ?? "—"} />
            {m.plan_symbol && <Field label="Plan symbol" value={m.plan_symbol} />}
            {m.item_symbol && <Field label="Item symbol" value={m.item_symbol} />}
          </dl>
          {m.applications.length > 0 && (
            <Section title={`Applications (${m.applications.length})`}>
              <div className="space-y-1">
                {m.applications.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800">
                    <span className="text-zinc-800 dark:text-zinc-100">{a.display_name || a.application}</span>
                    <span className="text-xs text-zinc-400">
                      {a.coverage_rate != null ? `${a.coverage_rate} ${a.coverage_unit ?? ""} · ${a.coverage_method ?? "divide"}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
          <Section title={`Used in assemblies (${usedIn.length})`}>
            {usedIn.length === 0 ? <Empty>Not used by any assembly.</Empty> : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {usedIn.map((a) => linkChip("assembly", a.id, a.name ?? a.id, titleCase(a.operation_stage)))}
              </div>
            )}
          </Section>
        </>
      );
    }
  } else if (refItem.type === "equipment") {
    const e = equipmentById.get(refItem.id);
    if (e) {
      title = e.equipment_name ?? e.id;
      subtitle = `${titleCase(e.category)} · ${money(e.cost_per_unit)}/${e.unit}`;
      const usedIn = assembliesByEquip.get(e.id) ?? [];
      body = (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            <Field label="Class" value={titleCase(e.category)} />
            <Field label="Unit" value={e.unit} />
            <Field label="Cost/unit" value={money(e.cost_per_unit)} />
          </dl>
          <Section title={`Used in assemblies (${usedIn.length})`}>
            {usedIn.length === 0 ? <Empty>Not used by any assembly.</Empty> : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {usedIn.map((a) => linkChip("assembly", a.id, a.name ?? a.id, titleCase(a.operation_stage)))}
              </div>
            )}
          </Section>
        </>
      );
    }
  } else {
    const a = assemblyById.get(refItem.id);
    if (a) {
      title = a.name ?? a.id;
      subtitle = `${titleCase(a.operation_stage)} · per ${a.unit_of_work}`;
      body = (
        <>
          <Section title={`Role materials (${a.roles.length})`}>
            {a.roles.length === 0 ? <Empty>No roles.</Empty> : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {a.roles.map((r, i) => {
                  const hit = r.application_id ? appIndex.get(r.application_id) : null;
                  if (!hit) return (
                    <div key={i} className="rounded-lg border border-dashed border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-400 dark:border-zinc-700">
                      {r.role_key || "role"} — unlinked
                    </div>
                  );
                  return linkChip("material", hit.material.id, hit.material.material_name ?? hit.material.id, hit.app.display_name || hit.app.application || undefined);
                })}
              </div>
            )}
          </Section>
          <Section title={`Equipment (${a.equipment.length})`}>
            {a.equipment.length === 0 ? <Empty>No equipment attached.</Empty> : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {a.equipment.map((e, i) => {
                  const eq = e.equipment_id ? equipmentById.get(e.equipment_id) : null;
                  return eq ? linkChip("equipment", eq.id, eq.equipment_name ?? eq.id, titleCase(eq.category)) : (
                    <div key={i} className="rounded-lg border border-dashed border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-400 dark:border-zinc-700">unlinked</div>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {props.canGoBack && (
              <button onClick={props.onBack} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Back">←</button>
            )}
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
            </div>
          </div>
          <button onClick={props.onClose} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">✕</button>
        </div>

        {/* Photos */}
        <PhotoStrip
          photos={props.photos}
          locked={props.locked}
          uploading={props.uploading}
          onUpload={props.onUpload}
          onDelete={props.onDeletePhoto}
          onSetCover={props.onSetCover}
        />

        <div className="mt-4 space-y-4">{body}</div>
      </div>
    </div>
  );
}

function PhotoStrip({ photos, locked, uploading, onUpload, onDelete, onSetCover }: {
  photos: Photo[]; locked: boolean; uploading: boolean;
  onUpload: (f: File) => void; onDelete: (id: string) => void; onSetCover: (id: string) => void;
}) {
  return (
    <div>
      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
        <p className="rounded-lg bg-zinc-50 py-6 text-center text-sm text-zinc-400 dark:bg-zinc-800">No photos yet.</p>
      )}
      {!locked && (
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
          {uploading ? "Uploading…" : "+ Add photo"}
          <input type="file" accept="image/*" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
        </label>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-zinc-800 dark:text-zinc-100">{value ?? "—"}</dd>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h4>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-400">{children}</p>;
}
