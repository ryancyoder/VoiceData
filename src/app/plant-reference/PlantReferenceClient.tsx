"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  ExternalLink,
  LayoutGrid,
  Rows3,
  Leaf,
  ChevronLeft,
  Layers,
  Lock,
  Unlock,
  Upload,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  PLANT_CATEGORIES,
  SUN_OPTIONS,
  MOISTURE_OPTIONS,
  formatInches,
  plantImageUrl,
  type Plant,
  type PlantQueryResult,
  type PlantAlbum,
  type PlantAlbumsResult,
} from "@/lib/plants";

export function PlantReferenceClient() {
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [sun, setSun] = useState("");
  const [moisture, setMoisture] = useState("");
  const [native, setNative] = useState(false);
  const [deer, setDeer] = useState(false);
  const [evergreen, setEvergreen] = useState(false);
  const [page, setPage] = useState(1);
  const [groupMode, setGroupMode] = useState<"albums" | "all">("albums");
  const [drill, setDrill] = useState<PlantAlbum | null>(null);
  const [layout, setLayout] = useState<"gallery" | "table">("gallery");
  const [loading, setLoading] = useState(true);
  const [plantResult, setPlantResult] = useState<PlantQueryResult>({ plants: [], total: 0, page: 1, pageSize: 50 });
  const [albumResult, setAlbumResult] = useState<PlantAlbumsResult>({ albums: [], total: 0, page: 1, pageSize: 50 });
  const [selected, setSelected] = useState<Plant | null>(null);
  // Edit mode: the whole page is read-only until unlocked. When unlocked,
  // clicking a plant opens an editor (photo upload + field editing) instead of
  // the read-only detail card. reloadKey forces a refetch after a save.
  const [locked, setLocked] = useState(true);
  const [editing, setEditing] = useState<Plant | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Showing the album grid (grouped mode, not drilled into a species).
  const inAlbumList = groupMode === "albums" && !drill;

  // Debounced search; typing resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (sun) params.set("sun", sun);
    if (moisture) params.set("moisture", moisture);
    if (native) params.set("native", "1");
    if (deer) params.set("deer", "1");
    if (evergreen) params.set("evergreen", "1");
    params.set("page", String(page));

    if (inAlbumList) {
      fetch(`/api/plants/albums?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : { albums: [], total: 0, page, pageSize: 50 }))
        .then((d: PlantAlbumsResult) => {
          if (active) {
            setAlbumResult(d);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) {
            setAlbumResult({ albums: [], total: 0, page, pageSize: 50 });
            setLoading(false);
          }
        });
    } else {
      if (drill) {
        params.set("genus", drill.genus ?? "");
        params.set("species", drill.species ?? "");
      }
      fetch(`/api/plants?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : { plants: [], total: 0, page, pageSize: 50 }))
        .then((d: PlantQueryResult) => {
          if (active) {
            setPlantResult(d);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) {
            setPlantResult({ plants: [], total: 0, page, pageSize: 50 });
            setLoading(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [q, category, sun, moisture, native, deer, evergreen, page, inAlbumList, drill, reloadKey]);

  const anyFilter = !!(q || category || sun || moisture || native || deer || evergreen);
  const clearAll = useCallback(() => {
    setQInput("");
    setQ("");
    setCategory("");
    setSun("");
    setMoisture("");
    setNative(false);
    setDeer(false);
    setEvergreen(false);
    setPage(1);
  }, []);

  const openDrill = useCallback((album: PlantAlbum) => {
    setDrill(album);
    setPage(1);
  }, []);
  const closeDrill = useCallback(() => {
    setDrill(null);
    setPage(1);
  }, []);
  const switchGroup = useCallback((mode: "albums" | "all") => {
    setGroupMode(mode);
    setDrill(null);
    setPage(1);
  }, []);

  const active = inAlbumList ? albumResult : plantResult;
  const totalPages = Math.max(1, Math.ceil(active.total / active.pageSize));
  const rangeFrom = active.total === 0 ? 0 : (active.page - 1) * active.pageSize + 1;
  const rangeTo = Math.min(active.total, active.page * active.pageSize);
  const noun = inAlbumList ? "species" : "plants";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Plant Reference</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Horticultural catalog — {active.total ? active.total.toLocaleString() : ""} {noun}, searchable by
            conditions, size, and traits.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => {
              setLocked((v) => !v);
              setEditing(null);
              setSelected(null);
            }}
            title={locked ? "Unlock to edit plants and photos" : "Lock (read-only)"}
            aria-label={locked ? "Unlock editing" : "Lock editing"}
            aria-pressed={!locked}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              locked
                ? "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                : "bg-amber-500 text-white hover:bg-amber-600"
            }`}
          >
            {locked ? <Lock size={16} /> : <Unlock size={16} />}
            <span className="hidden sm:inline">{locked ? "Locked" : "Editing"}</span>
          </button>
          <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {(["gallery", "table"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLayout(l)}
                title={l === "gallery" ? "Gallery view" : "Table view"}
                aria-label={l === "gallery" ? "Gallery view" : "Table view"}
                className={`flex items-center justify-center rounded-full px-3 py-1.5 transition-colors ${
                  layout === l
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {l === "gallery" ? <LayoutGrid size={16} /> : <Rows3 size={16} />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!locked && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <Unlock size={15} className="shrink-0" />
          <span>Editing is unlocked — select a plant to change its photo or details.</span>
        </div>
      )}

      {/* Grouping toggle / breadcrumb */}
      <div className="mb-3">
        {drill ? (
          <button
            onClick={closeDrill}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ChevronLeft size={16} /> Albums
            <span className="ml-1 text-zinc-400">/</span>
            <span className="italic">{drill.album_key}</span>
            {drill.common ? <span className="text-zinc-400">· {drill.common}</span> : null}
          </button>
        ) : (
          <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
            <GroupBtn label="Albums" active={groupMode === "albums"} onClick={() => switchGroup("albums")} />
            <GroupBtn label="All plants" active={groupMode === "all"} onClick={() => switchGroup("all")} />
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search botanical, common, or genus…"
              className="w-full rounded-full border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <Select value={sun} onChange={(v) => { setSun(v); setPage(1); }} placeholder="Any sun" options={SUN_OPTIONS} />
          <Select value={moisture} onChange={(v) => { setMoisture(v); setPage(1); }} placeholder="Any moisture" options={MOISTURE_OPTIONS} />
          <Toggle label="Native" active={native} onClick={() => { setNative((v) => !v); setPage(1); }} />
          <Toggle label="Deer-resistant" active={deer} onClick={() => { setDeer((v) => !v); setPage(1); }} />
          <Toggle label="Evergreen" active={evergreen} onClick={() => { setEvergreen((v) => !v); setPage(1); }} />
          {anyFilter && (
            <button onClick={clearAll} className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200">
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip label="All" active={category === ""} onClick={() => { setCategory(""); setPage(1); }} />
          {PLANT_CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={category === c} onClick={() => { setCategory(c); setPage(1); }} />
          ))}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : inAlbumList ? (
        albumResult.albums.length === 0 ? (
          <Empty anyFilter={anyFilter} onClear={clearAll} noun="species" />
        ) : layout === "gallery" ? (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {albumResult.albums.map((a) => (
              <li
                key={a.album_key}
                onClick={() => openDrill(a)}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="relative aspect-square">
                  <PlantImg image={a.image} alt={a.album_key} className="h-full w-full object-cover" />
                  {a.cultivars > 1 && (
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
                      <Layers size={12} /> {a.cultivars}
                    </span>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-2 pt-8">
                    <p className="truncate text-sm font-medium italic text-white drop-shadow-sm">{a.album_key}</p>
                    {a.common && <p className="truncate text-xs text-white/80">{a.common}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="w-14 px-3 py-2 font-medium"></th>
                  <th className="px-3 py-2 font-medium">Species</th>
                  <th className="px-3 py-2 font-medium">Common</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Cultivars</th>
                </tr>
              </thead>
              <tbody>
                {albumResult.albums.map((a) => (
                  <tr
                    key={a.album_key}
                    onClick={() => openDrill(a)}
                    className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50/70 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                  >
                    <td className="px-3 py-1.5">
                      <PlantImg image={a.image} alt="" className="h-10 w-10 rounded object-cover" small />
                    </td>
                    <td className="px-3 py-2 font-medium italic text-zinc-800 dark:text-zinc-200">{a.album_key}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{a.common || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{a.category || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{a.cultivars}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : plantResult.plants.length === 0 ? (
        <Empty anyFilter={anyFilter} onClear={clearAll} noun="plants" />
      ) : layout === "gallery" ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {plantResult.plants.map((p) => (
            <li
              key={p.id}
              onClick={() => (locked ? setSelected(p) : setEditing(p))}
              className="group relative cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="relative aspect-square">
                <PlantImg image={p.image} alt={p.botanical ?? ""} className="h-full w-full object-cover" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pb-2 pt-8">
                  <p className="truncate text-sm font-medium italic text-white drop-shadow-sm">{p.botanical || "Unknown"}</p>
                  {p.common && <p className="truncate text-xs text-white/80">{p.common}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="w-14 px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 font-medium">Botanical</th>
                <th className="px-3 py-2 font-medium">Common</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Zone</th>
                <th className="px-3 py-2 font-medium">Sun</th>
                <th className="px-3 py-2 font-medium">Height</th>
                <th className="px-3 py-2 font-medium">Bloom</th>
                <th className="px-3 py-2 font-medium">Traits</th>
              </tr>
            </thead>
            <tbody>
              {plantResult.plants.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => (locked ? setSelected(p) : setEditing(p))}
                  className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50/70 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                >
                  <td className="px-3 py-1.5">
                    <PlantImg image={p.image} alt="" className="h-10 w-10 rounded object-cover" small />
                  </td>
                  <td className="px-3 py-2 font-medium italic text-zinc-800 dark:text-zinc-200">{p.botanical || "—"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{p.common || "—"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{p.category || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{p.zone || "—"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{p.sun?.join(", ") || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{formatInches(p.height_in)}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{p.bloom_color?.join(", ") || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.native && <Badge>Native</Badge>}
                      {p.evergreen && <Badge>Evergreen</Badge>}
                      {p.deer_resistant && <Badge>Deer-res.</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && (inAlbumList ? albumResult.albums.length : plantResult.plants.length) > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>
            {rangeFrom.toLocaleString()}–{rangeTo.toLocaleString()} of {active.total.toLocaleString()} {noun}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={active.page <= 1}
              className="rounded-full border border-zinc-300 px-3 py-1 font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
            >
              Prev
            </button>
            <span>
              Page {active.page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={active.page >= totalPages}
              className="rounded-full border border-zinc-300 px-3 py-1 font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {selected && <PlantDetail plant={selected} onClose={() => setSelected(null)} />}
      {editing && (
        <PlantEditor
          plant={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadKey((k) => k + 1);
          }}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </main>
  );
}

function Empty({ anyFilter, onClear, noun }: { anyFilter: boolean; onClear: () => void; noun: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">No {noun} match these filters.</p>
      {anyFilter && (
        <button onClick={onClear} className="mt-3 text-sm font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300">
          Clear search &amp; filters
        </button>
      )}
    </div>
  );
}

function GroupBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-emerald-600 text-white"
          : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}

function Select({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: readonly string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="cursor-pointer rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </span>
  );
}

// Renders a plant's album-cover image, falling back to a leaf placeholder when
// there's no image path or the file isn't in the bucket yet (404).
function PlantImg({
  image,
  alt,
  className,
  small,
}: {
  image: string | null;
  alt: string;
  className: string;
  small?: boolean;
}) {
  const url = plantImageUrl(image);
  const [failed, setFailed] = useState(false);
  // Reset the error state when the image path changes (e.g. after a re-upload)
  // so a fresh URL gets another chance to load.
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    return (
      <div className={`flex items-center justify-center bg-zinc-100 text-zinc-300 dark:bg-zinc-800 dark:text-zinc-600 ${className}`}>
        <Leaf size={small ? 16 : 28} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />
  );
}

function PlantDetail({ plant, onClose }: { plant: Plant; onClose: () => void }) {
  const rows: { label: string; value: string }[] = useMemo(() => {
    const arr = (a: string[] | null | undefined) => (a && a.length ? a.join(", ") : "—");
    const yn = (b: boolean | null | undefined) => (b ? "Yes" : "—");
    return [
      { label: "Common name", value: plant.common || "—" },
      { label: "Category", value: plant.category || "—" },
      { label: "Type", value: plant.type || "—" },
      { label: "Hardiness zone", value: plant.zone || "—" },
      { label: "Sun", value: arr(plant.sun) },
      { label: "Moisture", value: arr(plant.moisture) },
      { label: "Soil", value: arr(plant.soil) },
      { label: "Soil pH", value: arr(plant.soil_ph) },
      { label: "Height", value: formatInches(plant.height_in) },
      { label: "Width", value: formatInches(plant.width_in) },
      { label: "Spread", value: formatInches(plant.spread_in) },
      { label: "Bloom season", value: arr(plant.bloom_season) },
      { label: "Bloom color", value: arr(plant.bloom_color) },
      { label: "Foliage color", value: arr(plant.foliage_color) },
      { label: "Texture", value: plant.texture || "—" },
      { label: "Form", value: plant.form || "—" },
      { label: "Growth rate", value: plant.growth_rate || "—" },
      { label: "Native", value: yn(plant.native) },
      { label: "Evergreen", value: yn(plant.evergreen) },
      { label: "Deer resistant", value: yn(plant.deer_resistant) },
      { label: "Rabbit resistant", value: yn(plant.rabbit_resistant) },
      { label: "Pollinator value", value: plant.pollinator_value || "—" },
      { label: "Attracts", value: arr(plant.attracts) },
      { label: "Seasonal interest", value: arr(plant.seasonal_interest) },
      { label: "Matrix role", value: plant.matrix_role || "—" },
      { label: "Design style", value: arr(plant.design_style) },
      { label: "Features", value: arr(plant.features) },
    ];
  }, [plant]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold italic text-zinc-900 dark:text-zinc-50">{plant.botanical || "Plant"}</h2>
            {plant.common && <p className="text-sm text-zinc-500 dark:text-zinc-400">{plant.common}</p>}
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {plant.image && (
            <div className="mb-4 overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800">
              <PlantImg image={plant.image} alt={plant.botanical ?? ""} className="max-h-72 w-full object-cover" />
            </div>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-4 border-b border-zinc-50 py-1 dark:border-zinc-800/60">
                <dt className="text-xs text-zinc-400">{r.label}</dt>
                <dd className="text-right text-sm text-zinc-700 dark:text-zinc-300">{r.value}</dd>
              </div>
            ))}
          </dl>
          {plant.source_url && (
            <a
              href={plant.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Source <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editing (unlocked): change a plant's photo and its catalog fields.
// ---------------------------------------------------------------------------

type FieldKind = "text" | "number" | "array";

const TEXT_GROUPS: { title: string; fields: { key: keyof Plant; label: string; kind: FieldKind }[] }[] = [
  {
    title: "Identity",
    fields: [
      { key: "botanical", label: "Botanical name", kind: "text" },
      { key: "common", label: "Common name", kind: "text" },
      { key: "genus", label: "Genus", kind: "text" },
      { key: "species", label: "Species", kind: "text" },
      { key: "cultivar", label: "Cultivar", kind: "text" },
      { key: "type", label: "Type", kind: "text" },
      { key: "category", label: "Category", kind: "text" },
      { key: "zone", label: "Hardiness zone", kind: "text" },
    ],
  },
  {
    title: "Growing conditions",
    fields: [
      { key: "sun", label: "Sun", kind: "array" },
      { key: "moisture", label: "Moisture", kind: "array" },
      { key: "soil", label: "Soil", kind: "array" },
      { key: "soil_ph", label: "Soil pH", kind: "array" },
    ],
  },
  {
    title: "Size (inches)",
    fields: [
      { key: "height_in", label: "Height", kind: "number" },
      { key: "width_in", label: "Width", kind: "number" },
      { key: "spread_in", label: "Spread", kind: "number" },
    ],
  },
  {
    title: "Appearance",
    fields: [
      { key: "bloom_season", label: "Bloom season", kind: "array" },
      { key: "bloom_color", label: "Bloom color", kind: "array" },
      { key: "foliage_color", label: "Foliage color", kind: "array" },
      { key: "texture", label: "Texture", kind: "text" },
      { key: "form", label: "Form", kind: "text" },
      { key: "growth_rate", label: "Growth rate", kind: "text" },
    ],
  },
  {
    title: "Ecology & design",
    fields: [
      { key: "pollinator_value", label: "Pollinator value", kind: "text" },
      { key: "attracts", label: "Attracts", kind: "array" },
      { key: "seasonal_interest", label: "Seasonal interest", kind: "array" },
      { key: "matrix_role", label: "Matrix role", kind: "text" },
      { key: "design_style", label: "Design style", kind: "array" },
      { key: "features", label: "Features", kind: "array" },
      { key: "source_url", label: "Source URL", kind: "text" },
    ],
  },
];

const BOOL_FIELDS: { key: keyof Plant; label: string }[] = [
  { key: "native", label: "Native" },
  { key: "evergreen", label: "Evergreen" },
  { key: "deer_resistant", label: "Deer resistant" },
  { key: "rabbit_resistant", label: "Rabbit resistant" },
];

function initialForm(plant: Plant): Record<string, string> {
  const form: Record<string, string> = {};
  for (const g of TEXT_GROUPS) {
    for (const f of g.fields) {
      const v = plant[f.key];
      form[f.key as string] = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
    }
  }
  return form;
}

function PlantEditor({
  plant,
  onClose,
  onSaved,
  onChanged,
}: {
  plant: Plant;
  onClose: () => void;
  onSaved: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => initialForm(plant));
  const [bools, setBools] = useState<Record<string, boolean>>(() => ({
    native: !!plant.native,
    evergreen: !!plant.evergreen,
    deer_resistant: !!plant.deer_resistant,
    rabbit_resistant: !!plant.rabbit_resistant,
  }));
  const [image, setImage] = useState<string | null>(plant.image);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = { ...form, ...bools };
    try {
      const res = await fetch(`/api/plants/${plant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/plants/${plant.id}/image`, { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Upload failed (${res.status})`);
      }
      const d: { image: string } = await res.json();
      setImage(d.image);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removePhoto = async () => {
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plants/${plant.id}/image`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Remove failed (${res.status})`);
      }
      setImage(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Unlock size={16} className="text-amber-500" />
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Edit plant</h2>
              <p className="text-xs italic text-zinc-500 dark:text-zinc-400">{plant.botanical || plant.common || `#${plant.id}`}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Photo */}
          <div className="mb-5 flex items-center gap-4">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
              <PlantImg image={image} alt={plant.botanical ?? ""} className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {image ? "Replace photo" : "Upload photo"}
              </button>
              {image && (
                <button
                  onClick={removePhoto}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Trash2 size={15} /> Remove photo
                </button>
              )}
            </div>
          </div>

          {/* Fields */}
          {TEXT_GROUPS.map((g) => (
            <fieldset key={g.title} className="mb-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{g.title}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <label key={f.key as string} className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {f.label}
                      {f.kind === "array" && <span className="text-zinc-400"> (comma-separated)</span>}
                    </span>
                    <input
                      type={f.kind === "number" ? "number" : "text"}
                      value={form[f.key as string] ?? ""}
                      onChange={(e) => set(f.key as string, e.target.value)}
                      className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset className="mb-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Traits</legend>
            <div className="flex flex-wrap gap-4">
              {BOOL_FIELDS.map((b) => (
                <label key={b.key as string} className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={!!bools[b.key as string]}
                    onChange={(e) => setBools((s) => ({ ...s, [b.key]: e.target.checked }))}
                    className="h-4 w-4 rounded border-zinc-300 accent-emerald-600 dark:border-zinc-600"
                  />
                  {b.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
