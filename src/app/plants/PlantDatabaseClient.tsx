"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
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

export function PlantDatabaseClient() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<LibraryKind>("perspective-stamp");
  const [adding, setAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const shown = useMemo(
    () =>
      items.filter(
        (i) =>
          i.kind === kind &&
          i.data?.category !== "textures" &&
          !(i.data?.name ?? "").startsWith("tex-"),
      ),
    [items, kind],
  );

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
                onClick={() => setKind(k.id)}
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={adding}
            className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {adding ? "Adding…" : "Add plants"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading library…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No {kind === "plan-symbol" ? "symbols" : "plants"} yet.
          </p>
        </div>
      ) : (
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
      )}
    </main>
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
