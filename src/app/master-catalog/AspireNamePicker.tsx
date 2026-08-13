"use client";

import { useEffect, useRef, useState } from "react";

interface AspireItem {
  item_name: string;
  category_name: string | null;
  item_type: string | null;
  purchase_unit_type: string | null;
  item_cost: number | null;
}

function money(n: number | null): string {
  if (n == null) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

// A typeahead that maps a material to an exact Aspire catalog item. Searches the
// aspire_catalog reference table and shows name · category · unit · cost per
// option; selecting one writes the exact item name back via onChange.
export function AspireNamePicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const [items, setItems] = useState<AspireItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setQuery(value ?? ""), [value]);

  // Debounced search while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/aspire-catalog?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setItems(Array.isArray(data.items) ? data.items : []);
        setActive(0);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, open]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(it: AspireItem) {
    onChange(it.item_name);
    setQuery(it.item_name);
    setOpen(false);
  }

  const inputCls = `w-full rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 ${
    compact ? "min-w-44" : ""
  }`;

  return (
    <div ref={boxRef} className="relative">
      <input
        className={inputCls}
        value={query}
        disabled={disabled}
        placeholder="Search Aspire catalog…"
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter" && items[active]) { e.preventDefault(); pick(items[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && !disabled && (
        <div className="absolute z-30 mt-1 max-h-72 w-[22rem] max-w-[80vw] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
          {loading && items.length === 0 ? (
            <div className="px-3 py-3 text-xs text-zinc-400">Searching…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-3 text-xs text-zinc-400">
              No matches. Import the Aspire catalog if the picker is empty.
            </div>
          ) : (
            items.map((it, i) => (
              <button
                key={it.item_name}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(it); }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full flex-col gap-0.5 border-b border-zinc-100 px-3 py-1.5 text-left last:border-0 dark:border-zinc-700/70 ${
                  i === active ? "bg-emerald-50 dark:bg-emerald-950/40" : ""
                }`}
              >
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{it.item_name}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {it.category_name && <span>{it.category_name}</span>}
                  {it.purchase_unit_type && <span>· {it.purchase_unit_type}</span>}
                  {it.item_cost != null && <span>· {money(it.item_cost)}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
