"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DealPhoto } from "@/lib/salesBoard";

interface Group {
  id: string;
  label: string;
  sqFt: number;
  linearFt: number;
  height: number;
}

function dims(g: Group): string {
  const parts: string[] = [];
  if (g.sqFt) parts.push(`${g.sqFt.toLocaleString("en-US", { maximumFractionDigits: 1 })} sq ft`);
  if (g.linearFt) parts.push(`${g.linearFt.toLocaleString("en-US", { maximumFractionDigits: 1 })} ln ft`);
  if (g.height) parts.push(`${g.height.toLocaleString("en-US", { maximumFractionDigits: 1 })} ft H`);
  return parts.join(" · ");
}

// Link a photo to one or more of its deal's estimate take-off groups.
export default function EstimateGroupLinker({ photo, onClose }: { photo: DealPhoto; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/photos/${photo.id}/estimate-groups`);
      const data = await res.json();
      setEstimateId(data.estimateId ?? null);
      setProjectName(data.projectName ?? null);
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setLinked(new Set(Array.isArray(data.linkedGroupIds) ? data.linkedGroupIds : []));
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, [photo.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(group: Group) {
    if (!estimateId) return;
    const isLinked = linked.has(group.id);
    setBusy(group.id);
    try {
      const res = await fetch(`/api/estimator/estimates/${estimateId}/photo-links`, {
        method: isLinked ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id, photoId: photo.id }),
      });
      if (res.ok) {
        setLinked((prev) => {
          const next = new Set(prev);
          if (isLinked) next.delete(group.id);
          else next.add(group.id);
          return next;
        });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Link to take-off</h2>
            {projectName && <p className="text-xs text-zinc-500">{projectName}</p>}
          </div>
          <button onClick={onClose} className="text-xl leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-zinc-400">Loading…</div>
          ) : !estimateId ? (
            <p className="py-6 text-center text-sm text-zinc-500">This photo&apos;s deal has no estimate yet.</p>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              The estimate has no take-off groups yet.{" "}
              <Link href={`/estimator/${estimateId}`} className="text-indigo-600 underline">
                Open estimate
              </Link>
            </p>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => {
                const on = linked.has(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggle(g)}
                    disabled={busy === g.id}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left disabled:opacity-50 ${
                      on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-zinc-200 hover:border-indigo-300 dark:border-zinc-700"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        on ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-600"
                      }`}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{g.label}</span>
                      {dims(g) && <span className="block truncate text-xs text-zinc-500">{dims(g)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button onClick={onClose} className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
