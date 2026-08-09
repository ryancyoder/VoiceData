"use client";

import { useEffect, useState } from "react";
import { Search, X, Leaf } from "lucide-react";
import { plantImageUrl, type Plant } from "@/lib/plants";

// Search the Plant Reference catalog and pick an entry to link a design stamp
// to. Returns the chosen plant's id + botanical name to the caller.
export function ReferencePlantPicker({
  currentName,
  onClose,
  onPick,
}: {
  currentName?: string;
  onClose: () => void;
  onPick: (plant: Plant) => void;
}) {
  const [qInput, setQInput] = useState(currentName ?? "");
  const [q, setQ] = useState(currentName ?? "");
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ pageSize: "24" });
    if (q) params.set("q", q);
    fetch(`/api/plants?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { plants: [] }))
      .then((d: { plants: Plant[] }) => {
        if (active) {
          setPlants(d.plants ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setPlants([]);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Link to a reference plant</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search botanical, common, or genus…"
              className="w-full rounded-full border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-zinc-400">Searching…</p>
          ) : plants.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">No matching plants.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {plants.map((p) => {
                const url = plantImageUrl(p.image);
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => onPick(p)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-100 text-zinc-300 dark:bg-zinc-800 dark:text-zinc-600">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Leaf size={16} />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium italic text-zinc-800 dark:text-zinc-200">
                          {p.botanical || "Unknown"}
                        </span>
                        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {[p.common, p.category].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
