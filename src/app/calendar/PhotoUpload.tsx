"use client";

import { useMemo, useRef, useState } from "react";
import exifr from "exifr";
import styles from "./calendar.module.css";
import type { DealOption } from "./CalendarClient";
import { withTimeout } from "@/lib/withTimeout";

const GPS_READ_TIMEOUT_MS = 6000;
const MATCH_FETCH_TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60000;

interface MatchCandidate {
  id: number;
  deal_name: string;
  company: string | null;
  jobsite_address: string | null;
  stage: string;
  isLost: boolean;
  distanceMeters: number;
  matchedBy: "address" | "photos";
}

interface PendingPhoto {
  id: string;
  file: File;
  previewUrl: string;
  gps: { latitude: number; longitude: number } | null;
  candidates: MatchCandidate[];
  selectedDealId: number | "";
  status: "matching" | "ready" | "uploading" | "done" | "error";
  error?: string;
}

async function readClientGps(file: File) {
  try {
    const gps = await withTimeout(exifr.gps(file), GPS_READ_TIMEOUT_MS, "GPS read");
    if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
      return { latitude: gps.latitude, longitude: gps.longitude };
    }
  } catch {
    /* no readable GPS, or the read timed out — fall back to manual deal selection */
  }
  return null;
}

function distanceLabel(meters: number) {
  if (meters < 1000) return `${meters}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}

export default function PhotoUpload({
  dealOptions,
  onUploaded,
}: {
  dealOptions: DealOption[];
  onUploaded: () => void;
}) {
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFilesSelected(fileList: FileList) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const items: PendingPhoto[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      gps: null,
      candidates: [],
      selectedDealId: "",
      status: "matching",
    }));
    setPending((p) => [...p, ...items]);
    setPanelOpen(true);

    // Each file is matched independently and in parallel — a slow or stuck
    // file (large HEIC, unusual EXIF) only delays itself, not the batch.
    await Promise.all(
      items.map(async (item) => {
        const gps = await readClientGps(item.file);
        let candidates: MatchCandidate[] = [];
        if (gps) {
          try {
            const res = await fetch("/api/sales-board/match-location", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(gps),
              signal: AbortSignal.timeout(MATCH_FETCH_TIMEOUT_MS),
            });
            const data = await res.json();
            if (res.ok) candidates = data.candidates ?? [];
          } catch {
            /* match lookup failed or timed out — user can still pick a deal manually */
          }
        }
        const best = candidates[0];
        const autoSelected: number | "" = best ? best.id : "";
        setPending((p) =>
          p.map((it) => (it.id === item.id ? { ...it, gps, candidates, selectedDealId: autoSelected, status: "ready" } : it))
        );
      })
    );
  }

  function removePending(id: string) {
    setPending((p) => {
      const item = p.find((it) => it.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return p.filter((it) => it.id !== id);
    });
  }

  function closePanel() {
    for (const item of pending) URL.revokeObjectURL(item.previewUrl);
    setPending([]);
    setPanelOpen(false);
  }

  async function handleUploadAll() {
    setUploading(true);
    let anyUploaded = false;

    for (const item of pending) {
      if (item.status === "done" || item.selectedDealId === "") continue;
      setPending((p) => p.map((it) => (it.id === item.id ? { ...it, status: "uploading" } : it)));
      try {
        const formData = new FormData();
        formData.append("file", item.file);
        const res = await fetch(`/api/sales-board/${item.selectedDealId}/photos`, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        anyUploaded = true;
        setPending((p) => p.map((it) => (it.id === item.id ? { ...it, status: "done" } : it)));
      } catch (err) {
        const message =
          err instanceof Error && err.name === "TimeoutError" ? "Upload timed out — try again" : err instanceof Error ? err.message : "Upload failed";
        setPending((p) =>
          p.map((it) => (it.id === item.id ? { ...it, status: "error", error: message } : it))
        );
      }
    }

    setUploading(false);
    if (anyUploaded) onUploaded();
  }

  const readyCount = pending.filter((p) => p.status !== "done" && p.selectedDealId !== "").length;
  const allResolved = pending.every((p) => p.status !== "matching");

  const dominantMatch = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of pending) {
      if (typeof item.selectedDealId === "number") {
        counts.set(item.selectedDealId, (counts.get(item.selectedDealId) ?? 0) + 1);
      }
    }
    let bestId: number | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        bestId = id;
        bestCount = count;
      }
    }
    if (bestId == null) return null;

    const name =
      pending.flatMap((p) => p.candidates).find((c) => c.id === bestId)?.deal_name ??
      dealOptions.find((d) => d.id === bestId)?.deal_name ??
      `Deal #${bestId}`;
    return { id: bestId, name, count: bestCount };
  }, [pending, dealOptions]);

  function setAllToDeal(dealId: number) {
    setPending((p) => p.map((it) => (it.status === "done" ? it : { ...it, selectedDealId: dealId })));
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) handleFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" className={styles["nav-btn"]} onClick={() => inputRef.current?.click()}>
        + Add Photo
      </button>

      {panelOpen && (
        <div
          className={styles["modal-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget && !uploading) closePanel();
          }}
        >
          <div className={styles["modal-panel"]}>
            <div className={styles["modal-head"]}>
              <div>
                <h2 className={styles["modal-title"]}>Add photos</h2>
                <div className={styles["modal-subtitle"]}>
                  GPS location is used to suggest a matching deal — confirm or change before uploading.
                </div>
              </div>
              <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={closePanel} disabled={uploading}>
                ×
              </button>
            </div>

            {dominantMatch && pending.length > 1 && (
              <div className={styles["bulk-match-bar"]}>
                <span>
                  {dominantMatch.count} of {pending.length} photo{pending.length === 1 ? "" : "s"} best-match{" "}
                  <strong>{dominantMatch.name}</strong>
                </span>
                <button
                  type="button"
                  className={styles["bulk-match-btn"]}
                  disabled={uploading}
                  onClick={() => setAllToDeal(dominantMatch.id)}
                >
                  Set all {pending.length} to {dominantMatch.name}
                </button>
              </div>
            )}

            <div className={styles["upload-list"]}>
              {pending.map((item) => (
                <div key={item.id} className={styles["upload-item"]}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt="" className={styles["upload-thumb"]} />
                  <div className={styles["upload-item-main"]}>
                    {item.status === "matching" && <div className={styles["upload-status"]}>Reading location…</div>}
                    {item.status !== "matching" && (
                      <>
                        {!item.gps && <div className={styles["upload-status"]}>No location data — choose a deal.</div>}
                        {item.gps && item.candidates.length === 0 && (
                          <div className={styles["upload-status"]}>No nearby deal found — choose a deal.</div>
                        )}
                        {item.gps && item.candidates.length > 0 && (
                          <div className={styles["upload-status"]}>
                            Best match: {item.candidates[0].deal_name} · {distanceLabel(item.candidates[0].distanceMeters)}
                          </div>
                        )}
                        <select
                          className={styles["upload-select"]}
                          value={item.selectedDealId}
                          disabled={item.status === "uploading" || item.status === "done"}
                          onChange={(e) =>
                            setPending((p) =>
                              p.map((it) =>
                                it.id === item.id ? { ...it, selectedDealId: e.target.value ? Number(e.target.value) : "" } : it
                              )
                            )
                          }
                        >
                          <option value="">Select a deal…</option>
                          {item.candidates.length > 0 && (
                            <optgroup label="Nearby matches">
                              {item.candidates.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.deal_name} — {distanceLabel(c.distanceMeters)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="All deals">
                            {dealOptions.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.deal_name}
                                {d.company ? ` (${d.company})` : ""}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {item.status === "error" && <div className={styles["upload-error"]}>{item.error}</div>}
                        {item.status === "done" && <div className={styles["upload-done"]}>Uploaded ✓</div>}
                      </>
                    )}
                  </div>
                  {item.status !== "uploading" && item.status !== "done" && (
                    <button
                      type="button"
                      className={styles["upload-remove"]}
                      aria-label="Remove"
                      onClick={() => removePending(item.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className={styles["upload-actions"]}>
              <button type="button" className={styles["card-edit-cancel"]} onClick={closePanel} disabled={uploading}>
                {pending.every((p) => p.status === "done") ? "Close" : "Cancel"}
              </button>
              <button
                type="button"
                className={styles["card-edit-save"]}
                disabled={!allResolved || readyCount === 0 || uploading}
                onClick={handleUploadAll}
              >
                {uploading ? "Uploading…" : `Upload ${readyCount || ""}`.trim()}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
