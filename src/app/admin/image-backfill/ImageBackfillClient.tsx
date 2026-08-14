"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { compressImage } from "@/lib/compressImage";

// One-time utility that recompresses already-stored images (deal-photos and
// plant-images) to reclaim Supabase Storage space. It downloads each object,
// runs it through the SAME browser compression as live uploads, and — only in
// Apply mode — overwrites the object in place (path preserved, so every DB
// reference keeps resolving). Dry run does everything except the overwrite, so
// the reported savings are real, not estimated. Safe to stop and resume: a
// re-scan skips objects that are already small.

const BUCKETS = ["deal-photos", "plant-images"];
const CONCURRENCY = 3;
const MAX_DIMENSION = 1800;
const QUALITY = 0.78;
// Only bother with objects meaningfully larger than a compressed target.
const THRESHOLD = 600_000;

type Item = { bucket: string; path: string; size: number };
type LogEntry = {
  path: string;
  before: number;
  after: number;
  status: "shrunk" | "skipped" | "error";
  message?: string;
};

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} kB`;
  return `${n} B`;
}

export default function ImageBackfillClient() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [apply, setApply] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [shrunk, setShrunk] = useState(0);
  const [savedBytes, setSavedBytes] = useState(0);
  const [errors, setErrors] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  async function scan() {
    setScanning(true);
    setError(null);
    setItems(null);
    setLog([]);
    setProcessed(0);
    setShrunk(0);
    setSavedBytes(0);
    setErrors(0);
    try {
      const all: Item[] = [];
      let bytes = 0;
      for (const bucket of BUCKETS) {
        const res = await fetch(`/api/admin/image-backfill?bucket=${encodeURIComponent(bucket)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Scan failed");
        all.push(...(data.items as Item[]));
        bytes += data.totalBytes as number;
      }
      all.sort((a, b) => b.size - a.size);
      setItems(all);
      setTotalBytes(bytes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function processOne(item: Item): Promise<LogEntry> {
    try {
      const res = await fetch(
        `/api/admin/image-backfill/object?bucket=${encodeURIComponent(item.bucket)}&path=${encodeURIComponent(item.path)}`
      );
      if (!res.ok) throw new Error(`download ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], item.path.split("/").pop() || "image", {
        type: blob.type || "image/jpeg",
      });
      const compressed = await compressImage(file, {
        maxDimension: MAX_DIMENSION,
        quality: QUALITY,
        skipBelowBytes: 0,
      });
      // Only replace when it's a meaningful win (>5% smaller).
      if (compressed.size >= item.size * 0.95) {
        return { path: item.path, before: item.size, after: item.size, status: "skipped" };
      }
      if (apply) {
        const fd = new FormData();
        fd.append("bucket", item.bucket);
        fd.append("path", item.path);
        fd.append("file", compressed);
        const up = await fetch(`/api/admin/image-backfill`, { method: "POST", body: fd });
        const upData = await up.json();
        if (!up.ok) throw new Error(upData.error || `upload ${up.status}`);
      }
      return { path: item.path, before: item.size, after: compressed.size, status: "shrunk" };
    } catch (e) {
      return {
        path: item.path,
        before: item.size,
        after: item.size,
        status: "error",
        message: e instanceof Error ? e.message : "failed",
      };
    }
  }

  async function run() {
    if (!items || items.length === 0) return;
    setRunning(true);
    setError(null);
    stopRef.current = false;
    setProcessed(0);
    setShrunk(0);
    setSavedBytes(0);
    setErrors(0);
    setLog([]);

    const queue = items;
    let idx = 0;
    async function worker() {
      while (!stopRef.current) {
        const i = idx++;
        if (i >= queue.length) break;
        const entry = await processOne(queue[i]);
        setProcessed((p) => p + 1);
        setLog((l) => (l.length < 400 ? [...l, entry] : l));
        if (entry.status === "shrunk") {
          setShrunk((s) => s + 1);
          setSavedBytes((b) => b + (entry.before - entry.after));
        } else if (entry.status === "error") {
          setErrors((e) => e + 1);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  }

  const total = items?.length ?? 0;
  const pct = total ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-1 flex-col gap-6 bg-zinc-50 p-6 font-sans dark:bg-black">
      <header>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Image compression backfill</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          One-time utility: recompresses already-stored photos in the{" "}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">deal-photos</code> and{" "}
          <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">plant-images</code> buckets to reclaim
          Supabase Storage space. Each image is downscaled to {MAX_DIMENSION}px and re-encoded — the same
          compression new uploads already use.{" "}
          <Link href="/" className="underline">
            ← Home
          </Link>
        </p>
      </header>

      {/* Step 1: scan */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            {items === null
              ? "Scan to find oversized images."
              : `${items.length} image${items.length === 1 ? "" : "s"} over ${fmtBytes(THRESHOLD)} · ${fmtBytes(totalBytes)} total`}
          </div>
          <button
            type="button"
            onClick={scan}
            disabled={scanning || running}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            {scanning ? "Scanning…" : items === null ? "Scan" : "Rescan"}
          </button>
        </div>
      </div>

      {/* Step 2: run */}
      {items !== null && items.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={apply}
              disabled={running}
              onChange={(e) => setApply(e.target.checked)}
            />
            Apply changes (overwrite originals). Leave unchecked for a dry run.
          </label>
          {apply && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              ⚠ Overwrites the stored images in place with smaller re-encoded versions. This is lossy and
              cannot be undone. Run a dry run first.
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-sm text-zinc-700 dark:text-zinc-300">
              {running || processed > 0
                ? `${processed}/${total} · ${shrunk} shrunk · ${fmtBytes(savedBytes)} ${apply ? "saved" : "savable"}${errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}`
                : apply
                  ? "Ready to apply."
                  : "Ready for a dry run."}
            </div>
            {running ? (
              <button
                type="button"
                onClick={() => {
                  stopRef.current = true;
                }}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                className={`rounded-full px-4 py-2 text-sm font-medium text-white ${apply ? "bg-red-600" : "bg-zinc-900 dark:bg-zinc-100 dark:text-black"}`}
              >
                {apply ? "Apply compression" : "Dry run"}
              </button>
            )}
          </div>

          {(running || processed > 0) && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-400">
            Runs {CONCURRENCY} at a time in this browser — leave the tab open until it finishes. Safe to stop
            and resume; a rescan skips images already compressed.
          </p>
        </div>
      )}

      {items !== null && items.length === 0 && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Nothing to do — no images over {fmtBytes(THRESHOLD)}.
        </p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {log.length > 0 && (
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {log
            .slice()
            .reverse()
            .map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 font-mono text-xs">
                <span className="truncate text-zinc-600 dark:text-zinc-400">{item.path}</span>
                <span
                  className={
                    item.status === "shrunk"
                      ? "shrink-0 text-emerald-600 dark:text-emerald-400"
                      : item.status === "error"
                        ? "shrink-0 text-red-500"
                        : "shrink-0 text-zinc-400"
                  }
                >
                  {item.status === "shrunk"
                    ? `${fmtBytes(item.before)} → ${fmtBytes(item.after)}`
                    : item.status === "error"
                      ? `error: ${item.message ?? ""}`
                      : "skipped"}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
