"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, LayoutGrid, Rows3, Search } from "lucide-react";
import type { LibraryItemData, LibraryKind } from "@/lib/design/library";
import {
  TOP_LEVEL_CATEGORIES,
  getSubcategoriesForTopLevel,
  getSubcategoryLabel,
} from "@/components/design/engine/categoryGroups";

interface LibraryItem {
  id: string;
  kind: LibraryKind;
  data: LibraryItemData;
  imageUrl: string | null;
}

// Built-in category options (the global database has no per-project custom
// subcategories, so pass []). Textures aren't plants — drop them.
const CATEGORY_OPTIONS: { id: string; label: string }[] = TOP_LEVEL_CATEGORIES.flatMap((top) =>
  getSubcategoriesForTopLevel(top.id, [])
    .filter((sub) => sub !== "textures")
    .map((sub) => ({ id: sub, label: getSubcategoryLabel(sub, []) })),
);

const KINDS: { id: LibraryKind; label: string }[] = [
  { id: "perspective-stamp", label: "Plants" },
  { id: "plan-symbol", label: "2D Symbols" },
];

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const mime = /:(.*?);/.exec(dataUrl.slice(0, comma))?.[1] || "image/png";
  const bin = atob(dataUrl.slice(comma + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// A library item as it appears in an exported JSON (old-app format): metadata
// plus the image inline as a base64 data URL.
interface ExportedItem {
  id?: string;
  name?: string;
  category?: string;
  dataUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  createdAt?: number;
  botanicalName?: string;
  commonName?: string;
  notes?: string;
}

export function PlantDatabaseClient() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<LibraryKind>("perspective-stamp");
  const [layout, setLayout] = useState<"gallery" | "table">("gallery");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/design/library");
        const data = res.ok ? await res.json() : { items: [] };
        if (active) setItems(data.items ?? []);
      } catch {
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // All items of the current kind (excluding textures) — the pool the filter
  // bar and search narrow down.
  const kindItems = useMemo(
    () =>
      items.filter(
        (i) =>
          i.kind === kind &&
          i.data?.category !== "textures" &&
          !(i.data?.name ?? "").startsWith("tex-"),
      ),
    [items, kind],
  );

  // Categories actually present in this kind, with counts, for the filter bar.
  const categoriesPresent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of kindItems) {
      const c = it.data?.category || "custom";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count, label: CATEGORY_OPTIONS.find((c) => c.id === id)?.label ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [kindItems]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kindItems.filter((it) => {
      if (categoryFilter !== "all" && (it.data?.category || "custom") !== categoryFilter) return false;
      if (!q) return true;
      const d = it.data ?? ({} as LibraryItemData);
      return [d.name, d.botanicalName, d.commonName, d.notes].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      );
    });
  }, [kindItems, categoryFilter, search]);

  // Persist a metadata change: merge the patch into the item's data and PATCH
  // the whole data object (the route replaces data).
  const updateItem = useCallback(async (id: string, patch: Partial<LibraryItemData>) => {
    let nextData: LibraryItemData | undefined;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        nextData = { ...it.data, ...patch };
        return { ...it, data: nextData };
      }),
    );
    if (!nextData) return;
    try {
      await fetch(`/api/design/library/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextData }),
      });
    } catch {
      /* optimistic; reload reflects server truth */
    }
  }, []);

  const deleteItem = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
    try {
      await fetch(`/api/design/library/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* optimistic */
    }
  }, []);

  const addFiles = useCallback(
    async (files: FileList) => {
      setAdding(true);
      try {
        for (const file of Array.from(files)) {
          if (!file.type.startsWith("image/")) continue;
          const dims = await new Promise<{ w: number; h: number }>((resolve) => {
            const url = URL.createObjectURL(file);
            const img = new window.Image();
            img.onload = () => {
              URL.revokeObjectURL(url);
              resolve({ w: img.naturalWidth, h: img.naturalHeight });
            };
            img.onerror = () => {
              URL.revokeObjectURL(url);
              resolve({ w: 100, h: 100 });
            };
            img.src = url;
          });
          const id = `${kind === "plan-symbol" ? "plan" : "custom"}-${crypto.randomUUID()}`;
          const data: LibraryItemData = {
            name: file.name.replace(/\.[^.]+$/, ""),
            category: "custom",
            naturalWidth: dims.w,
            naturalHeight: dims.h,
            createdAt: Date.now(),
          };
          const form = new FormData();
          form.append("file", file);
          form.append("id", id);
          form.append("kind", kind);
          form.append("data", JSON.stringify(data));
          const res = await fetch("/api/design/library", { method: "POST", body: form });
          if (res.ok) {
            const { item } = (await res.json()) as { item: LibraryItem };
            setItems((prev) => [...prev, item]);
          }
        }
      } finally {
        setAdding(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [kind],
  );

  // Import a JSON library export (old-app format) into the CURRENT tab's kind.
  // Sequential with progress — the reliable path for large libraries — and it
  // skips items already present so it's safe to re-run.
  const importJson = useCallback(
    async (file: File) => {
      let arr: ExportedItem[];
      try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed)) throw new Error("not an array");
        arr = parsed;
      } catch {
        window.alert("That file isn't a valid library export (expected a JSON array).");
        return;
      }
      const existing = new Set(items.map((i) => i.id));
      const toImport = arr.filter((s) => s && s.dataUrl && !(s.id && existing.has(s.id)));
      if (toImport.length === 0) {
        window.alert("Nothing new to import — these items are already in your library.");
        return;
      }
      setImportProgress({ done: 0, total: toImport.length });
      for (let i = 0; i < toImport.length; i++) {
        const s = toImport[i];
        try {
          const id =
            typeof s.id === "string" && s.id
              ? s.id
              : `${kind === "plan-symbol" ? "plan" : "custom"}-${crypto.randomUUID()}`;
          const data: LibraryItemData = {
            name: s.name || "Imported",
            category: s.category || "custom",
            naturalWidth: s.naturalWidth || 100,
            naturalHeight: s.naturalHeight || 100,
            createdAt: s.createdAt || Date.now(),
            botanicalName: s.botanicalName,
            commonName: s.commonName,
            notes: s.notes,
          };
          const form = new FormData();
          form.append("file", dataUrlToBlob(s.dataUrl as string), `${id}.png`);
          form.append("id", id);
          form.append("kind", kind);
          form.append("data", JSON.stringify(data));
          const res = await fetch("/api/design/library", { method: "POST", body: form });
          if (res.ok) {
            const { item } = (await res.json()) as { item: LibraryItem };
            setItems((prev) => [...prev, item]);
          }
        } catch {
          /* skip this item, keep going */
        }
        setImportProgress({ done: i + 1, total: toImport.length });
      }
      setImportProgress(null);
      if (importInputRef.current) importInputRef.current.value = "";
    },
    [items, kind],
  );

  // Export the current tab's items as a self-contained JSON (images inlined),
  // matching the old-app format — a portable backup.
  const exportJson = useCallback(async () => {
    setExporting(true);
    try {
      const rows: ExportedItem[] = await Promise.all(
        shown.map(async (it) => {
          let dataUrl = "";
          if (it.imageUrl) {
            try {
              dataUrl = await blobToDataUrl(await (await fetch(it.imageUrl)).blob());
            } catch {
              /* leave dataUrl empty on fetch failure */
            }
          }
          return { id: it.id, ...it.data, dataUrl };
        }),
      );
      const blob = new Blob([JSON.stringify(rows)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "plan-symbol" ? "plan-symbols.json" : "plants.json";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [shown, kind]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Plant Database
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Your reusable plant &amp; symbol library — the same items you place in designs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => {
                  setKind(k.id);
                  setCategoryFilter("all");
                }}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  kind === k.id
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
          />
          <button
            onClick={exportJson}
            disabled={exporting || shown.length === 0}
            className="shrink-0 rounded-full border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importProgress !== null}
            className="shrink-0 rounded-full border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {importProgress ? `Importing ${importProgress.done}/${importProgress.total}…` : "Import"}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={adding}
            className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {adding ? "Adding…" : "Add plants"}
          </button>
        </div>
      </div>

      {/* Search + category filter bar */}
      {!loading && kindItems.length > 0 && (
        <div className="mb-4 flex flex-col gap-3">
          <div className="relative max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, botanical, notes…"
              className="w-full rounded-full border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          {categoriesPresent.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip label="All" count={kindItems.length} active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")} />
              {categoriesPresent.map((c) => (
                <FilterChip
                  key={c.id}
                  label={c.label}
                  count={c.count}
                  active={categoryFilter === c.id}
                  onClick={() => setCategoryFilter(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading library…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {kindItems.length === 0
              ? `No ${kind === "plan-symbol" ? "symbols" : "plants"} yet.`
              : "No matches."}
          </p>
          {kindItems.length > 0 && (
            <button
              onClick={() => {
                setSearch("");
                setCategoryFilter("all");
              }}
              className="mt-3 text-sm font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              Clear search &amp; filters
            </button>
          )}
        </div>
      ) : layout === "table" ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
              <tr className="text-zinc-500 dark:text-zinc-400">
                <th className="w-14 px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Botanical name</th>
                <th className="px-3 py-2 font-medium">Common name</th>
                <th className="w-44 px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="w-12 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <PlantRow
                  key={item.id}
                  item={item}
                  onUpdate={(patch) => updateItem(item.id, patch)}
                  onDelete={() => deleteItem(item.id, item.data?.name ?? "this item")}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shown.map((item) => (
            <GalleryCard
              key={item.id}
              item={item}
              onUpdate={(patch) => updateItem(item.id, patch)}
              onDelete={() => deleteItem(item.id, item.data?.name ?? "this item")}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label} <span className="opacity-60">{count}</span>
    </button>
  );
}

function GalleryCard({
  item,
  onUpdate,
  onDelete,
}: {
  item: LibraryItem;
  onUpdate: (patch: Partial<LibraryItemData>) => void;
  onDelete: () => void;
}) {
  const d = item.data ?? ({} as LibraryItemData);
  const categoryKnown = CATEGORY_OPTIONS.some((c) => c.id === d.category);
  return (
    <li className="group relative overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Image tile — light checkerboard-ish bg so transparent cutouts read well */}
      <div className="flex aspect-square items-center justify-center bg-[linear-gradient(45deg,#f4f4f5_25%,transparent_25%,transparent_75%,#f4f4f5_75%),linear-gradient(45deg,#f4f4f5_25%,transparent_25%,transparent_75%,#f4f4f5_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] p-3 dark:bg-[linear-gradient(45deg,#27272a_25%,transparent_25%,transparent_75%,#27272a_75%),linear-gradient(45deg,#27272a_25%,transparent_25%,transparent_75%,#27272a_75%)]">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={d.name ?? ""} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-zinc-400">No image</span>
        )}
      </div>
      <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
        <EditableCell value={d.name ?? ""} placeholder="Name" onCommit={(v) => onUpdate({ name: v })} />
        <select
          value={d.category ?? "custom"}
          onChange={(e) => onUpdate({ category: e.target.value })}
          className="mt-1 w-full cursor-pointer rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-zinc-500 outline-none hover:border-zinc-300 focus:border-blue-400 dark:text-zinc-400 dark:hover:border-zinc-600"
        >
          {!categoryKnown && d.category && <option value={d.category}>{d.category}</option>}
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={onDelete}
        title="Delete"
        aria-label={`Delete ${d.name ?? "item"}`}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-500 opacity-0 shadow-sm transition-opacity hover:text-red-600 group-hover:opacity-100 dark:bg-zinc-950/90 dark:text-zinc-300"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

function PlantRow({
  item,
  onUpdate,
  onDelete,
}: {
  item: LibraryItem;
  onUpdate: (patch: Partial<LibraryItemData>) => void;
  onDelete: () => void;
}) {
  const d = item.data ?? ({} as LibraryItemData);
  const categoryKnown = CATEGORY_OPTIONS.some((c) => c.id === d.category);
  return (
    <tr className="group border-t border-zinc-100 hover:bg-zinc-50/60 dark:border-zinc-800 dark:hover:bg-zinc-900/40">
      <td className="px-3 py-1.5">
        <div className="h-10 w-10 rounded border border-zinc-200 bg-zinc-100 bg-contain bg-center bg-no-repeat dark:border-zinc-700 dark:bg-zinc-800">
          {item.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className="h-full w-full object-contain" />
          )}
        </div>
      </td>
      <td className="px-3 py-1.5">
        <EditableCell value={d.name ?? ""} placeholder="Name" onCommit={(v) => onUpdate({ name: v })} />
      </td>
      <td className="px-3 py-1.5">
        <EditableCell value={d.botanicalName ?? ""} placeholder="Botanical name" italic onCommit={(v) => onUpdate({ botanicalName: v })} />
      </td>
      <td className="px-3 py-1.5">
        <EditableCell value={d.commonName ?? ""} placeholder="Common name" onCommit={(v) => onUpdate({ commonName: v })} />
      </td>
      <td className="px-3 py-1.5">
        <select
          value={d.category ?? "custom"}
          onChange={(e) => onUpdate({ category: e.target.value })}
          className="w-full cursor-pointer rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-zinc-300 focus:border-blue-400 dark:hover:border-zinc-600"
        >
          {!categoryKnown && d.category && <option value={d.category}>{d.category}</option>}
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <EditableCell value={d.notes ?? ""} placeholder="Notes" onCommit={(v) => onUpdate({ notes: v })} />
      </td>
      <td className="px-3 py-1.5">
        <button
          onClick={onDelete}
          title="Delete"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-300 opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950/40"
        >
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  );
}

function EditableCell({
  value,
  placeholder,
  italic,
  onCommit,
}: {
  value: string;
  placeholder: string;
  italic?: boolean;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) onCommit(trimmed);
  }, [draft, value, onCommit]);

  if (editing) {
    return (
      <input
        autoFocus
        className={`w-full rounded border border-blue-400 bg-white px-1.5 py-1 text-sm text-zinc-900 outline-none dark:bg-zinc-950 dark:text-zinc-100 ${italic ? "italic" : ""}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div
      className={`min-h-[28px] cursor-text rounded border border-transparent px-1.5 py-1 hover:border-zinc-300 dark:hover:border-zinc-600 ${italic ? "italic" : ""} ${value ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-300 dark:text-zinc-600"}`}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || placeholder}
    </div>
  );
}
