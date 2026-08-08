"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, X, ExternalLink } from "lucide-react";
import {
  PLANT_CATEGORIES,
  SUN_OPTIONS,
  MOISTURE_OPTIONS,
  formatInches,
  type Plant,
  type PlantQueryResult,
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
  const [result, setResult] = useState<PlantQueryResult>({ plants: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Plant | null>(null);

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
    fetch(`/api/plants?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { plants: [], total: 0, page, pageSize: 50 }))
      .then((d: PlantQueryResult) => {
        if (active) {
          setResult(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setResult({ plants: [], total: 0, page, pageSize: 50 });
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [q, category, sun, moisture, native, deer, evergreen, page]);

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

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const rangeFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const rangeTo = Math.min(result.total, result.page * result.pageSize);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Plant Reference</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Horticultural catalog — search and filter {result.total ? result.total.toLocaleString() : ""} plants by
          conditions, size, and traits.
        </p>
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
        <p className="text-sm text-zinc-400">Loading plants…</p>
      ) : result.plants.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No plants match these filters.</p>
          {anyFilter && (
            <button onClick={clearAll} className="mt-3 text-sm font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300">
              Clear search &amp; filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
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
                {result.plants.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50/70 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                  >
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

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
            <span>
              {rangeFrom.toLocaleString()}–{rangeTo.toLocaleString()} of {result.total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={result.page <= 1}
                className="rounded-full border border-zinc-300 px-3 py-1 font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
              >
                Prev
              </button>
              <span>
                Page {result.page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={result.page >= totalPages}
                className="rounded-full border border-zinc-300 px-3 py-1 font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && <PlantDetail plant={selected} onClose={() => setSelected(null)} />}
    </main>
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
