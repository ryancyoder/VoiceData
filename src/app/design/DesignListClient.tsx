"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProjectSummary } from "@/lib/design/project";
import { migrateLegacyProjectIfAny } from "@/components/design/store/projectPersistence";

export function DesignListClient() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (): Promise<ProjectSummary[]> => {
    try {
      const res = await fetch("/api/design/projects");
      if (!res.ok) return [];
      const { projects } = (await res.json()) as { projects: ProjectSummary[] };
      return projects ?? [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      let list = await load();
      // First time in the multi-project world: lift any legacy single-project
      // design out of this browser's IndexedDB into Supabase.
      if (list.length === 0) {
        const migratedId = await migrateLegacyProjectIfAny();
        if (migratedId) list = await load();
      }
      if (active) {
        setProjects(list);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const createDesign = useCallback(async () => {
    const name = window.prompt("Name this design", "Untitled design");
    if (name === null) return; // cancelled
    setCreating(true);
    try {
      const res = await fetch("/api/design/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Untitled design" }),
      });
      if (!res.ok) {
        setCreating(false);
        return;
      }
      const { project } = (await res.json()) as { project: { id: string } };
      router.push(`/design/${project.id}`);
    } catch {
      setCreating(false);
    }
  }, [router]);

  const deleteDesign = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setProjects((prev) => prev.filter((p) => p.id !== id));
    try {
      await fetch(`/api/design/projects/${id}`, { method: "DELETE" });
    } catch {
      /* optimistic; a failed delete just reappears on next load */
    }
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Designs</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Perspective renderings — place plants, plan overlays, and lighting on a jobsite photo.
          </p>
        </div>
        <button
          onClick={createDesign}
          disabled={creating}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {creating ? "Creating…" : "New design"}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading designs…</p>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No designs yet.</p>
          <button
            onClick={createDesign}
            disabled={creating}
            className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Create your first design
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {projects.map((p) => (
            <li key={p.id} className="group relative">
              <Link
                href={`/design/${p.id}`}
                className="block overflow-hidden rounded-xl border border-zinc-200 bg-white transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div className="aspect-[4/3] w-full bg-zinc-100 dark:bg-zinc-800">
                  {p.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                      No photo yet
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </p>
                </div>
              </Link>
              <button
                onClick={() => deleteDesign(p.id, p.name)}
                aria-label={`Delete ${p.name}`}
                className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-xs font-medium text-zinc-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-red-600 dark:bg-zinc-950/90 dark:text-zinc-300"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
