"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Lock, Unlock, Upload, Trash2, Loader2, Package, Star } from "lucide-react";
import type { CatalogItem } from "@/lib/estimator/catalogItemColumns";
import type { CatalogPhoto } from "@/lib/estimator/catalogPhotos";

type PhotoMap = Record<string, CatalogPhoto[]>;

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function ItemCatalogClient() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [photos, setPhotos] = useState<PhotoMap>({});
  const [loading, setLoading] = useState(true);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [locked, setLocked] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // No synchronous setState here — `loading` starts true and the fetch clears
  // it; reloads after a photo change refresh silently (no spinner needed).
  function loadCatalog() {
    fetch("/api/estimator/catalog")
      .then((r) => (r.ok ? r.json() : { items: [], photos: {} }))
      .then((d: { items?: CatalogItem[]; photos?: PhotoMap }) => {
        setItems(d.items ?? []);
        setPhotos(d.photos ?? {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (category && it.category !== category) return false;
      if (!q) return true;
      const hay = `${it.name} ${it.category} ${it.id} ${it.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, q, category]);

  const coverOf = (id: string): CatalogPhoto | null => photos[id]?.[0] ?? null;
  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Item Catalog</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Browse catalog items and their reference photos. Unlock to add or remove photos.
          </p>
        </div>
        <button
          onClick={() => {
            setLocked((v) => !v);
            setSelectedId(null);
          }}
          title={locked ? "Unlock to add or remove photos" : "Lock (read-only)"}
          aria-pressed={!locked}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            locked
              ? "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              : "bg-amber-500 text-white hover:bg-amber-600"
          }`}
        >
          {locked ? <Lock size={16} /> : <Unlock size={16} />}
          <span className="hidden sm:inline">{locked ? "Locked" : "Editing"}</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search by name, category, id, or description…"
          className="w-full rounded-full border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          <Chip active={category === ""} onClick={() => setCategory("")}>
            All
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-zinc-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No items match your search.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((it) => {
            const cover = coverOf(it.id);
            const count = photos[it.id]?.length ?? 0;
            return (
              <li
                key={it.id}
                onClick={() => setSelectedId(it.id)}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="relative flex aspect-square items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover.url} alt={it.name} className="h-full w-full object-cover" />
                  ) : (
                    <Package size={32} className="text-zinc-300 dark:text-zinc-700" />
                  )}
                  {count > 1 && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {count}
                    </span>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100" title={it.name}>
                    {it.name}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{it.category}</span>
                    <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      {currency.format(it.unitPrice)}
                      <span className="text-zinc-400">/{it.unit}</span>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <ItemDetail
          item={selected}
          photos={photos[selected.id] ?? []}
          locked={locked}
          onClose={() => setSelectedId(null)}
          onPhotosChanged={() => loadCatalog()}
        />
      )}
    </main>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

// Read-only field row for the detail sheet.
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function ItemDetail({
  item,
  photos,
  locked,
  onClose,
  onPhotosChanged,
}: {
  item: CatalogItem;
  photos: CatalogPhoto[];
  locked: boolean;
  onClose: () => void;
  onPhotosChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/estimator/catalog/${item.id}/photos`, { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || "Upload failed");
      onPhotosChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(photoId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/estimator/catalog/${item.id}/photos/${photoId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Delete failed");
      }
      onPhotosChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function setCover(photoId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/estimator/catalog/${item.id}/photos/${photoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_cover: true }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Failed to set cover");
      }
      onPhotosChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set cover");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{item.name}</h2>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {item.category} · {currency.format(item.unitPrice)}/{item.unit}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* Photos */}
          {photos.length > 0 ? (
            <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p) => (
                <li
                  key={p.id}
                  className="group relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={item.name} className="aspect-square w-full object-cover" />
                  {p.is_cover && (
                    <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      <Star size={10} className="fill-current" /> Cover
                    </span>
                  )}
                  {!locked && (
                    <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {!p.is_cover && (
                        <button
                          onClick={() => setCover(p.id)}
                          disabled={busy}
                          title="Set as cover"
                          className="rounded-full bg-white/90 p-1 text-zinc-700 hover:bg-white disabled:opacity-50"
                        >
                          <Star size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => removePhoto(p.id)}
                        disabled={busy}
                        title="Delete photo"
                        className="rounded-full bg-white/90 p-1 text-red-600 hover:bg-white disabled:opacity-50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mb-4 flex aspect-video items-center justify-center rounded-xl border border-dashed border-zinc-300 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600">
              <Package size={40} />
            </div>
          )}

          {!locked && (
            <div className="mb-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Add photo
              </button>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
          )}

          {/* Fields */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="Item ID" value={item.id} />
            <Field label="Category" value={item.category} />
            <Field label="Unit" value={item.unit} />
            <Field label="Unit price" value={currency.format(item.unitPrice)} />
            <Field label="Takeoff unit" value={item.takeoffUnit} />
            <Field label="Coverage rate" value={item.coverageRate} />
            <Field label="Round to" value={item.roundTo} />
            <Field label="Units per load" value={item.unitsPerLoad} />
            <Field label="Plan symbol" value={item.planSymbol} />
            <Field label="Item symbol" value={item.itemSymbol} />
            <Field label="Price / face ft" value={item.pricePerFaceFt != null ? currency.format(item.pricePerFaceFt) : null} />
            <Field label="Price / linear ft" value={item.pricePerLinearFt != null ? currency.format(item.pricePerLinearFt) : null} />
            <Field label="Assembly" value={item.isAssembly ? "Yes" : null} />
            <Field label="Wall assembly" value={item.isWallAssembly ? "Yes" : null} />
            <Field label="Delivery fee" value={item.deliveryFee ? "Yes" : null} />
          </dl>
          {item.description && (
            <div className="mt-4">
              <dt className="text-xs uppercase tracking-wide text-zinc-400">Description</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{item.description}</dd>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
