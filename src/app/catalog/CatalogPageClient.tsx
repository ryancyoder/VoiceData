"use client";

import { useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { CatalogClient } from "./CatalogClient";
import { ItemCatalogClient } from "./ItemCatalogClient";

type View = "editor" | "gallery";

// The Catalog and the Item Catalog are two views of the same catalog data:
// "editor" is the spreadsheet-style estimator editor, "gallery" is the
// photo-forward reference browser. A shared toggle (injected into each view's
// header) switches between them.
export function CatalogPageClient() {
  const [view, setView] = useState<View>("editor");

  const toggle = (
    <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
      <button
        onClick={() => setView("editor")}
        title="Editor"
        aria-pressed={view === "editor"}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
          view === "editor"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        }`}
      >
        <Rows3 size={16} />
        <span className="hidden sm:inline">Editor</span>
      </button>
      <button
        onClick={() => setView("gallery")}
        title="Gallery"
        aria-pressed={view === "gallery"}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
          view === "gallery"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        }`}
      >
        <LayoutGrid size={16} />
        <span className="hidden sm:inline">Gallery</span>
      </button>
    </div>
  );

  return view === "editor" ? <CatalogClient viewToggle={toggle} /> : <ItemCatalogClient viewToggle={toggle} />;
}
