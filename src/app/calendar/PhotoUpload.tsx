"use client";

import { useMemo, useRef, useState } from "react";
import exifr from "exifr";
import styles from "./calendar.module.css";
import type { DealOption } from "./CalendarClient";
import { withTimeout, fetchWithTimeout } from "@/lib/withTimeout";
import { compressImage } from "@/lib/compressImage";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { capturePosterFrame } from "@/lib/videoPoster";
import { compressVideo } from "@/lib/compressVideo";

const GPS_READ_TIMEOUT_MS = 6000;
const MATCH_FETCH_TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60000;
const VIDEO_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const COMPRESSION_TIMEOUT_MS = 5 * 60 * 1000;

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
  mediaType: "photo" | "video";
  previewUrl: string;
  posterBlob: Blob | null;
  gps: { latitude: number; longitude: number } | null;
  takenAt: string | null;
  candidates: MatchCandidate[];
  selectedDealId: number | "";
  status: "matching" | "ready" | "uploading" | "done" | "error";
  error?: string;
}

// Reads GPS + capture-time from the ORIGINAL file, before any compression
// happens — canvas-based compression re-encodes the image and strips all
// EXIF metadata, so this must run first and the results carried separately.
async function readClientExif(file: File) {
  try {
    const exif = await withTimeout(
      exifr.parse(file, { gps: true, exif: true, ifd1: false, icc: false, iptc: false, xmp: false, interop: false }),
      GPS_READ_TIMEOUT_MS,
      "EXIF read"
    );
    const gps =
      exif && typeof exif.latitude === "number" && typeof exif.longitude === "number"
        ? { latitude: exif.latitude, longitude: exif.longitude }
        : null;
    const captured = exif?.DateTimeOriginal ?? exif?.CreateDate;
    const takenAt = captured instanceof Date && !isNaN(captured.getTime()) ? captured.toISOString() : null;
    return { gps, takenAt };
  } catch {
    /* no readable EXIF, or the read timed out — fall back to manual deal selection */
    return { gps: null, takenAt: null };
  }
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

    const items: PendingPhoto[] = files.map((file) => {
      const mediaType: "photo" | "video" = file.type.startsWith("video/") ? "video" : "photo";
      return {
        id: crypto.randomUUID(),
        file,
        mediaType,
        previewUrl: mediaType === "photo" ? URL.createObjectURL(file) : "",
        posterBlob: null,
        gps: null,
        // Videos aren't scanned for EXIF/GPS (no client-side library for
        // that here) — file.lastModified is the best capture-time guess we
        // have, and the user picks a deal manually for these.
        takenAt: mediaType === "video" && file.lastModified ? new Date(file.lastModified).toISOString() : null,
        candidates: [],
        selectedDealId: "",
        status: "matching",
      };
    });
    setPending((p) => [...p, ...items]);
    setPanelOpen(true);

    // Each file is matched independently and in parallel — a slow or stuck
    // file (large HEIC, unusual EXIF, big video) only delays itself, not
    // the batch.
    await Promise.all(
      items.map(async (item) => {
        if (item.mediaType === "video") {
          const posterBlob = await capturePosterFrame(item.file);
          const previewUrl = posterBlob ? URL.createObjectURL(posterBlob) : "";
          setPending((p) => p.map((it) => (it.id === item.id ? { ...it, posterBlob, previewUrl, status: "ready" } : it)));
          return;
        }

        const { gps, takenAt } = await readClientExif(item.file);
        let candidates: MatchCandidate[] = [];
        if (gps) {
          try {
            const res = await fetchWithTimeout(
              "/api/sales-board/match-location",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(gps),
              },
              MATCH_FETCH_TIMEOUT_MS
            );
            const data = await res.json();
            if (res.ok) candidates = data.candidates ?? [];
          } catch {
            /* match lookup failed or timed out — user can still pick a deal manually */
          }
        }
        const best = candidates[0];
        const autoSelected: number | "" = best ? best.id : "";
        setPending((p) =>
          p.map((it) =>
            it.id === item.id ? { ...it, gps, takenAt, candidates, selectedDealId: autoSelected, status: "ready" } : it
          )
        );
      })
    );
  }

  function removePending(id: string) {
    setPending((p) => {
      const item = p.find((it) => it.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return p.filter((it) => it.id !== id);
    });
  }

  function closePanel() {
    for (const item of pending) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setPending([]);
    setPanelOpen(false);
  }

  async function uploadPhotoItem(item: PendingPhoto) {
    // Compress after EXIF has already been read client-side — canvas
    // re-encoding strips metadata, so GPS/capture-time are carried as
    // separate fields instead of relying on the server re-reading them.
    const uploadFile = await compressImage(item.file);
    const formData = new FormData();
    formData.append("file", uploadFile);
    if (item.gps) {
      formData.append("latitude", String(item.gps.latitude));
      formData.append("longitude", String(item.gps.longitude));
    }
    if (item.takenAt) formData.append("takenAt", item.takenAt);
    const res = await fetchWithTimeout(
      `/api/sales-board/${item.selectedDealId}/photos`,
      { method: "POST", body: formData },
      UPLOAD_TIMEOUT_MS
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
  }

  // Videos upload straight from the browser to Supabase Storage via a
  // signed URL — routing them through our own API route would run into
  // Vercel's request body size limit, the same wall photo uploads hit
  // before client-side compression was added. Supabase Storage itself also
  // caps object size (50MB on the Free plan), so the video is re-encoded
  // client-side first to fit under that regardless of the original size.
  async function uploadVideoItemRaw(item: PendingPhoto) {
    const file = await withTimeout(compressVideo(item.file), COMPRESSION_TIMEOUT_MS, "Video compression");

    const urlRes = await fetchWithTimeout(
      `/api/sales-board/${item.selectedDealId}/videos/upload-url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoFileName: file.name, hasPoster: !!item.posterBlob }),
      },
      MATCH_FETCH_TIMEOUT_MS
    );
    const urlData = await urlRes.json();
    if (!urlRes.ok) throw new Error(urlData.error || "Failed to prepare video upload");

    const { error: videoUploadError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .uploadToSignedUrl(urlData.video.path, urlData.video.token, file, {
        contentType: file.type || undefined,
      });
    if (videoUploadError) throw new Error(videoUploadError.message);

    let posterPath: string | null = null;
    if (item.posterBlob && urlData.poster) {
      const { error: posterUploadError } = await supabase.storage
        .from(DEAL_PHOTOS_BUCKET)
        .uploadToSignedUrl(urlData.poster.path, urlData.poster.token, item.posterBlob, {
          contentType: "image/jpeg",
        });
      if (!posterUploadError) posterPath = urlData.poster.path;
    }

    const finalizeRes = await fetchWithTimeout(
      `/api/sales-board/${item.selectedDealId}/videos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath: urlData.video.path, posterPath, takenAt: item.takenAt }),
      },
      UPLOAD_TIMEOUT_MS
    );
    const finalizeData = await finalizeRes.json();
    if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to save video");
  }

  async function uploadVideoItem(item: PendingPhoto) {
    await withTimeout(uploadVideoItemRaw(item), VIDEO_UPLOAD_TIMEOUT_MS, "Video upload");
  }

  async function handleUploadAll() {
    setUploading(true);
    let anyUploaded = false;

    for (const item of pending) {
      if (item.status === "done" || item.selectedDealId === "") continue;
      setPending((p) => p.map((it) => (it.id === item.id ? { ...it, status: "uploading" } : it)));
      try {
        if (item.mediaType === "video") {
          await uploadVideoItem(item);
        } else {
          await uploadPhotoItem(item);
        }
        anyUploaded = true;
        setPending((p) => p.map((it) => (it.id === item.id ? { ...it, status: "done" } : it)));
      } catch (err) {
        const message =
          err instanceof Error && err.name === "AbortError"
            ? "Upload timed out — try again"
            : err instanceof Error
              ? err.message
              : "Upload failed";
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
        accept="image/*,video/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) handleFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" className={styles["nav-btn"]} onClick={() => inputRef.current?.click()}>
        + Add Photo/Video
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
                <h2 className={styles["modal-title"]}>Add photos &amp; videos</h2>
                <div className={styles["modal-subtitle"]}>
                  GPS location suggests a matching deal for photos — videos need a deal picked manually.
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
                  {item.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.previewUrl} alt="" className={styles["upload-thumb"]} />
                  ) : (
                    <div className={styles["upload-thumb-placeholder"]}>{item.mediaType === "video" ? "🎬" : "🖼"}</div>
                  )}
                  <div className={styles["upload-item-main"]}>
                    {item.status === "matching" && (
                      <div className={styles["upload-status"]}>
                        {item.mediaType === "video" ? "Capturing preview…" : "Reading location…"}
                      </div>
                    )}
                    {item.status !== "matching" && (
                      <>
                        {item.mediaType === "video" && (
                          <div className={styles["upload-status"]}>Video — choose a deal.</div>
                        )}
                        {item.mediaType === "photo" && !item.gps && (
                          <div className={styles["upload-status"]}>No location data — choose a deal.</div>
                        )}
                        {item.mediaType === "photo" && item.gps && item.candidates.length === 0 && (
                          <div className={styles["upload-status"]}>No nearby deal found — choose a deal.</div>
                        )}
                        {item.mediaType === "photo" && item.gps && item.candidates.length > 0 && (
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
