"use client";

import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS as RAW_CATEGORY_LABELS } from "@/lib/estimator/catalog";

const CATEGORY_LABELS = RAW_CATEGORY_LABELS as Record<string, string>;

interface CatalogItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  isAssembly?: boolean;
  takeoffUnit?: string;
  coverageRate?: number;
  roundTo?: number;
  unitsPerLoad?: number;
  deliveryFee?: boolean;
  isWallAssembly?: boolean;
  planSymbol?: string;
  [key: string]: unknown;
}

let idCounter = 0;

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function CatalogClient() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [deliveryRate, setDeliveryRate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch("/api/estimator/catalog")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load catalog"))))
      .then((data) => {
        setItems(Array.isArray(data.items) ? data.items : []);
        setDeliveryRate(typeof data.deliveryRate === "number" ? data.deliveryRate : 0);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const byCategory = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const cat of CATEGORIES) map.set(cat, []);
    for (const item of items) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return map;
  }, [items]);

  function markDirty() {
    setDirty(true);
    setSaveState("idle");
  }

  function updateItem(id: string, field: keyof CatalogItem, value: unknown) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
    markDirty();
  }

  function addItem(category: string) {
    const id = `custom-${category}-${Date.now()}-${++idCounter}`;
    setItems((prev) => [...prev, { id, name: "New Item", category, unit: "ea", unitPrice: 0 }]);
    markDirty();
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    markDirty();
  }

  async function handleSave() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/estimator/catalog", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, deliveryRate }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaveState("saved");
      setDirty(false);
    } catch {
      setSaveState("error");
    }
  }

  const totalCount = items.length;

  const numInput =
    "w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900";
  const textInput =
    "w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Catalog</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {loading ? "Loading…" : `${totalCount} items the estimator can use`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!locked && dirty && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-500">Unsaved changes</span>
          )}
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

      {/* Delivery rate */}
      <div className="mb-6 flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Delivery rate (per load)</span>
        {locked ? (
          <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{money(deliveryRate)}</span>
        ) : (
          <input
            type="number"
            step="1"
            value={deliveryRate}
            onChange={(e) => {
              setDeliveryRate(e.target.value === "" ? 0 : Number(e.target.value));
              markDirty();
            }}
            className={`${numInput} max-w-28`}
          />
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {locked && (
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
          The catalog is locked. Click <span className="font-semibold">🔒 Locked</span> to unlock and edit — nothing is
          saved until you press <span className="font-semibold">Save changes</span>.
        </p>
      )}

      {!loading &&
        CATEGORIES.map((cat) => {
          const catItems = byCategory.get(cat) ?? [];
          if (catItems.length === 0 && locked) return null;
          return (
            <section key={cat} className="mb-8">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {CATEGORY_LABELS[cat] ?? cat}{" "}
                  <span className="ml-1 font-normal text-zinc-400">({catItems.length})</span>
                </h2>
                {!locked && (
                  <button
                    onClick={() => addItem(cat)}
                    className="rounded-lg px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 dark:text-green-500 dark:hover:bg-green-950"
                  >
                    + Add item
                  </button>
                )}
              </div>
              <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Unit</th>
                      <th className="px-3 py-2 text-right font-medium">Unit Price</th>
                      <th className="px-3 py-2 text-center font-medium">Assembly</th>
                      <th className="px-3 py-2 text-right font-medium">Coverage</th>
                      <th className="px-3 py-2 font-medium">Takeoff</th>
                      <th className="px-3 py-2 text-right font-medium">Units/Load</th>
                      <th className="px-3 py-2 text-center font-medium">Delivery</th>
                      {!locked && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {catItems.map((item) => {
                      const isAsm = !!item.isAssembly;
                      const hasLoad = item.unitsPerLoad != null;
                      return (
                        <tr key={item.id} className="text-zinc-800 dark:text-zinc-200">
                          <td className="px-3 py-1.5">
                            {locked ? (
                              item.name
                            ) : (
                              <input className={textInput} value={item.name} onChange={(e) => updateItem(item.id, "name", e.target.value)} />
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {locked ? (
                              item.unit
                            ) : (
                              <input className={`${textInput} max-w-20`} value={item.unit} onChange={(e) => updateItem(item.id, "unit", e.target.value)} />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {locked ? (
                              money(item.unitPrice)
                            ) : (
                              <input
                                type="number"
                                step="0.01"
                                className={`${numInput} max-w-28`}
                                value={item.unitPrice}
                                onChange={(e) => updateItem(item.id, "unitPrice", e.target.value === "" ? 0 : Number(e.target.value))}
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center text-zinc-400">{isAsm ? "✓" : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {!isAsm ? (
                              <span className="text-zinc-300 dark:text-zinc-600">—</span>
                            ) : locked ? (
                              (item.coverageRate ?? "—")
                            ) : (
                              <input
                                type="number"
                                step="1"
                                className={`${numInput} max-w-24`}
                                value={item.coverageRate ?? ""}
                                onChange={(e) => updateItem(item.id, "coverageRate", e.target.value === "" ? undefined : Number(e.target.value))}
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {!isAsm ? (
                              <span className="text-zinc-300 dark:text-zinc-600">—</span>
                            ) : locked ? (
                              (item.takeoffUnit ?? "—")
                            ) : (
                              <input
                                className={`${textInput} max-w-24`}
                                value={item.takeoffUnit ?? ""}
                                onChange={(e) => updateItem(item.id, "takeoffUnit", e.target.value)}
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {!hasLoad ? (
                              <span className="text-zinc-300 dark:text-zinc-600">—</span>
                            ) : locked ? (
                              item.unitsPerLoad
                            ) : (
                              <input
                                type="number"
                                step="1"
                                className={`${numInput} max-w-24`}
                                value={item.unitsPerLoad ?? ""}
                                onChange={(e) => updateItem(item.id, "unitsPerLoad", e.target.value === "" ? undefined : Number(e.target.value))}
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {!hasLoad ? (
                              <span className="text-zinc-300 dark:text-zinc-600">—</span>
                            ) : (
                              <input
                                type="checkbox"
                                checked={!!item.deliveryFee}
                                disabled={locked}
                                onChange={(e) => updateItem(item.id, "deliveryFee", e.target.checked)}
                              />
                            )}
                          </td>
                          {!locked && (
                            <td className="px-3 py-1.5 text-right">
                              <button
                                onClick={() => removeItem(item.id)}
                                className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                                title="Remove item"
                                aria-label="Remove item"
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {catItems.length === 0 && (
                      <tr>
                        <td colSpan={locked ? 8 : 9} className="px-3 py-3 text-center text-sm text-zinc-400">
                          No items in this category.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
    </main>
  );
}
