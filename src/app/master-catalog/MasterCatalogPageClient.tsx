"use client";

import { useState } from "react";
import { MasterCatalogClient } from "./MasterCatalogClient";
import { MasterGalleryClient } from "./MasterGalleryClient";

type View = "editor" | "gallery";

// Two views of the same normalized master model: "editor" is the table editor
// (materials/applications/equipment/assemblies, editable + saveable), "gallery"
// is the photo-forward browsable reference with relationship cross-linking. A
// shared toggle (injected into each view's header) switches between them —
// same pattern as the /catalog editor⇄gallery.
export function MasterCatalogPageClient() {
  const [view, setView] = useState<View>("editor");

  const toggle = (
    <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
      <button
        onClick={() => setView("editor")}
        aria-pressed={view === "editor"}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
          view === "editor" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        }`}
      >
        Editor
      </button>
      <button
        onClick={() => setView("gallery")}
        aria-pressed={view === "gallery"}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
          view === "gallery" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        }`}
      >
        Gallery
      </button>
    </div>
  );

  return view === "editor" ? <MasterCatalogClient viewToggle={toggle} /> : <MasterGalleryClient viewToggle={toggle} />;
}
