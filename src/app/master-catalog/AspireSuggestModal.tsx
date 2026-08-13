"use client";

import { useCallback, useEffect, useState } from "react";

interface Suggestion {
  item_name: string;
  category_name: string | null;
  purchase_unit_type: string | null;
  item_cost: number | null;
  score: number;
}
interface Result {
  id: string;
  name: string;
  suggestions: Suggestion[];
}
interface MatMin {
  id: string;
  material_name?: string;
  aspire_name?: string | null;
}

const STRONG = 0.6;
const GOOD = 0.4;

function money(n: number | null): string {
  return n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function scoreBadge(score: number): { label: string; cls: string } {
  if (score >= STRONG) return { label: "Strong", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" };
  if (score >= GOOD) return { label: "Good", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" };
  return { label: "Weak", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" };
}

// Review the closest Aspire matches for the master materials and confirm-map in
// bulk. Accepting writes the exact Aspire item name back through onAccept (a
// normal unsaved edit — the user still presses Save changes).
export function AspireSuggestModal({
  materials,
  onAccept,
  onClose,
}: {
  materials: MatMin[];
  onAccept: (materialId: string, aspireName: string) => void;
  onClose: () => void;
}) {
  const [includeMapped, setIncludeMapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Local echo of what was mapped this session, id -> item name.
  const [accepted, setAccepted] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = materials
        .filter((m) => (m.material_name ?? "").trim() && (includeMapped || !(m.aspire_name ?? "").trim()))
        .map((m) => ({ id: m.id, name: m.material_name as string }));
      if (payload.length === 0) { setResults([]); setLoading(false); return; }
      const res = await fetch("/api/aspire-catalog/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materials: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load suggestions.");
      if (data.catalogEmpty) throw new Error("The Aspire catalog is empty — import it first (⬆ Import Aspire).");
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load suggestions.");
    } finally {
      setLoading(false);
    }
  }, [materials, includeMapped]);

  useEffect(() => { load(); }, [load]);

  function accept(id: string, name: string) {
    onAccept(id, name);
    setAccepted((prev) => new Map(prev).set(id, name));
  }

  function acceptAllStrong() {
    for (const r of results) {
      if (accepted.has(r.id)) continue;
      const top = r.suggestions[0];
      if (top && top.score >= STRONG) accept(r.id, top.item_name);
    }
  }

  const currentMap = new Map(materials.map((m) => [m.id, (m.aspire_name ?? "").trim()]));
  const strongPending = results.filter((r) => !accepted.has(r.id) && r.suggestions[0]?.score >= STRONG).length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Suggested Aspire matches</h2>
            <p className="text-xs text-zinc-500">Confirm a match to set the material&apos;s Aspire name. Save changes to persist.</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label="Close">×</button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-2 dark:border-zinc-800">
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={includeMapped} onChange={(e) => setIncludeMapped(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-600" />
            Include already-mapped materials
          </label>
          <button
            onClick={acceptAllStrong}
            disabled={strongPending === 0}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Accept all strong ({strongPending})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-zinc-400">Matching…</div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {includeMapped ? "No materials to match." : "Every material already has an Aspire name. Tick “include already-mapped” to re-check."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {results.map((r) => {
                const chosen = accepted.get(r.id) ?? null;
                const already = currentMap.get(r.id) || null;
                const top = r.suggestions[0];
                const isOpen = expanded.has(r.id);
                return (
                  <div key={r.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">{r.name}</span>
                      {chosen ? (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">✓ {chosen}</span>
                      ) : already ? (
                        <span className="shrink-0 truncate rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">now: {already}</span>
                      ) : null}
                    </div>

                    {r.suggestions.length === 0 ? (
                      <p className="text-xs text-zinc-400">No close matches found.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {(isOpen ? r.suggestions : top ? [top] : []).map((s) => {
                          const b = scoreBadge(s.score);
                          const isChosen = chosen === s.item_name;
                          return (
                            <div key={s.item_name} className="flex items-center gap-2 rounded-lg border border-zinc-100 px-2.5 py-1.5 dark:border-zinc-800">
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`} title={`score ${(s.score * 100).toFixed(0)}%`}>{b.label}</span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-zinc-800 dark:text-zinc-100">{s.item_name}</div>
                                <div className="flex flex-wrap gap-x-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                                  {s.category_name && <span>{s.category_name}</span>}
                                  {s.purchase_unit_type && <span>· {s.purchase_unit_type}</span>}
                                  {s.item_cost != null && <span>· {money(s.item_cost)}</span>}
                                </div>
                              </div>
                              <button
                                onClick={() => accept(r.id, s.item_name)}
                                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                                  isChosen ? "bg-emerald-600 text-white" : "border border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                                }`}
                              >
                                {isChosen ? "Mapped" : "Accept"}
                              </button>
                            </div>
                          );
                        })}
                        {r.suggestions.length > 1 && (
                          <button
                            onClick={() => setExpanded((prev) => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                            className="self-start text-[11px] text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                          >
                            {isOpen ? "Show fewer" : `Show ${r.suggestions.length - 1} more option${r.suggestions.length - 1 === 1 ? "" : "s"}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200 px-5 py-3 text-right dark:border-zinc-800">
          <button onClick={onClose} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">Done</button>
        </div>
      </div>
    </div>
  );
}
