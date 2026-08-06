"use client";

import { useMemo, useRef, useState } from "react";
import styles from "./calendar.module.css";
import type { PropertyOption } from "./CalendarClient";
import { withTimeout, fetchWithTimeout } from "@/lib/withTimeout";
import { compressImage } from "@/lib/compressImage";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET, formatPropertyLabel } from "@/lib/salesBoard";
import { capturePosterFrame } from "@/lib/videoPoster";
import { compressVideo } from "@/lib/compressVideo";
import { readClientExif } from "@/lib/clientExif";
import { readVideoCreationTime } from "@/lib/videoMetadata";

const MATCH_FETCH_TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60000;
const VIDEO_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const COMPRESSION_TIMEOUT_MS = 5 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

const NEW_PROPERTY = "new" as const;
const NO_LOCATION = "none" as const;

type PropertySelection = number | typeof NEW_PROPERTY | typeof NO_LOCATION | "";

interface MatchCandidate {
  id: number;
  address: string;
  contactLastName: string | null;
  distanceMeters: number;
  matchedBy: "address" | "events";
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
  selectedPropertyId: PropertySelection;
  newPropertyAddress: string;
  creatingProperty: boolean;
  status: "matching" | "ready" | "uploading" | "done" | "error";
  error?: string;
}

type UploadTarget = { kind: "property"; propertyId: number | null } | { kind: "event"; eventId: number };

function distanceLabel(meters: number) {
  if (meters < 1000) return `${meters}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}

function roundHalfHourRange(startMs: number, endMs: number): { startMs: number; endMs: number } {
  const roundedStart = Math.floor(startMs / HALF_HOUR_MS) * HALF_HOUR_MS;
  const roundedEnd = Math.ceil(endMs / HALF_HOUR_MS) * HALF_HOUR_MS;
  return { startMs: roundedStart, endMs: roundedEnd <= roundedStart ? roundedStart + HALF_HOUR_MS : roundedEnd };
}

export default function PhotoUpload({
  propertyOptions: initialPropertyOptions,
  onUploaded,
}: {
  propertyOptions: PropertyOption[];
  onUploaded: () => void;
}) {
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [propertyOptions, setPropertyOptions] = useState<PropertyOption[]>(initialPropertyOptions);
  const [panelOpen, setPanelOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: File[]) {
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
        takenAt: null,
        candidates: [],
        selectedPropertyId: "",
        newPropertyAddress: "",
        creatingProperty: false,
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
          const [posterBlob, creationTime] = await Promise.all([
            capturePosterFrame(item.file),
            readVideoCreationTime(item.file),
          ]);
          const previewUrl = posterBlob ? URL.createObjectURL(posterBlob) : "";
          const takenAt = creationTime
            ? creationTime.toISOString()
            : item.file.lastModified
              ? new Date(item.file.lastModified).toISOString()
              : null;
          setPending((p) =>
            p.map((it) => (it.id === item.id ? { ...it, posterBlob, previewUrl, takenAt, status: "ready" } : it))
          );
          return;
        }

        const { gps, takenAt } = await readClientExif(item.file);
        let candidates: MatchCandidate[] = [];
        if (gps) {
          try {
            const res = await fetchWithTimeout(
              "/api/properties/match-location",
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
            /* match lookup failed or timed out — user can still pick a property manually */
          }
        }
        const best = candidates[0];
        const autoSelected: PropertySelection = best ? best.id : "";
        setPending((p) =>
          p.map((it) =>
            it.id === item.id ? { ...it, gps, takenAt, candidates, selectedPropertyId: autoSelected, status: "ready" } : it
          )
        );
      })
    );
  }

  function handleFilesSelected(fileList: FileList) {
    return addFiles(Array.from(fileList));
  }

  async function handlePasteClick() {
    setPasteError(null);
    if (!navigator.clipboard?.read) {
      setPasteError("Clipboard access isn't supported in this browser");
      return;
    }
    setPasting(true);
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await clipboardItem.getType(imageType);
        const ext = imageType.split("/")[1] || "png";
        files.push(new File([blob], `pasted-${Date.now()}.${ext}`, { type: imageType }));
      }
      if (files.length === 0) {
        setPasteError("No image found on the clipboard");
        return;
      }
      await addFiles(files);
    } catch (err) {
      setPasteError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Clipboard access denied — check browser permissions"
          : "Couldn't read the clipboard"
      );
    } finally {
      setPasting(false);
    }
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

  async function createProperty(item: PendingPhoto) {
    const address = item.newPropertyAddress.trim();
    if (!address) return;
    setPending((p) => p.map((it) => (it.id === item.id ? { ...it, creatingProperty: true } : it)));
    try {
      const res = await fetchWithTimeout(
        "/api/properties",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) },
        MATCH_FETCH_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create property");
      const property = data.property as { id: number; address: string };
      const option: PropertyOption = { ...property, contactLastName: null };
      setPropertyOptions((opts) => (opts.some((o) => o.id === option.id) ? opts : [...opts, option]));
      setPending((p) =>
        p.map((it) => (it.id === item.id ? { ...it, selectedPropertyId: property.id, creatingProperty: false } : it))
      );
    } catch (err) {
      setPending((p) => p.map((it) => (it.id === item.id ? { ...it, creatingProperty: false } : it)));
      alert(err instanceof Error ? err.message : "Failed to create property");
    }
  }

  async function uploadPhotoItem(item: PendingPhoto, target: UploadTarget) {
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

    const url = target.kind === "event" ? `/api/events/${target.eventId}/photos` : "/api/photos";
    if (target.kind === "property" && target.propertyId != null) {
      formData.append("propertyId", String(target.propertyId));
    }

    const res = await fetchWithTimeout(url, { method: "POST", body: formData }, UPLOAD_TIMEOUT_MS);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
  }

  // Videos upload straight from the browser to Supabase Storage via a
  // signed URL — routing them through our own API route would run into
  // Vercel's request body size limit, the same wall photo uploads hit
  // before client-side compression was added. Supabase Storage itself also
  // caps object size (50MB on the Free plan), so the video is re-encoded
  // client-side first to fit under that regardless of the original size.
  async function uploadVideoItemRaw(item: PendingPhoto, target: UploadTarget) {
    const file = await withTimeout(compressVideo(item.file), COMPRESSION_TIMEOUT_MS, "Video compression");

    const uploadUrlPath = target.kind === "event" ? `/api/events/${target.eventId}/videos/upload-url` : "/api/videos/upload-url";
    const urlRes = await fetchWithTimeout(
      uploadUrlPath,
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

    const finalizePath = target.kind === "event" ? `/api/events/${target.eventId}/videos` : "/api/videos";
    const finalizeBody: Record<string, unknown> = { videoPath: urlData.video.path, posterPath, takenAt: item.takenAt };
    if (target.kind === "property" && target.propertyId != null) finalizeBody.propertyId = target.propertyId;

    const finalizeRes = await fetchWithTimeout(
      finalizePath,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(finalizeBody) },
      UPLOAD_TIMEOUT_MS
    );
    const finalizeData = await finalizeRes.json();
    if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to save video");
  }

  async function uploadVideoItem(item: PendingPhoto, target: UploadTarget) {
    await withTimeout(uploadVideoItemRaw(item, target), VIDEO_UPLOAD_TIMEOUT_MS, "Video upload");
  }

  // Items marked "No Location" have no property or GPS to cluster by, so
  // instead of reaching for a risky global "merge with any past no-location
  // event" fallback, the whole batch of them (from this one upload) is
  // clustered into a single new event up front, sized to span all of their
  // capture times — then each item attaches directly to that fixed event.
  async function createNoLocationBatchEvent(items: PendingPhoto[]): Promise<number> {
    const times = items.map((it) => (it.takenAt ? new Date(it.takenAt).getTime() : Date.now()));
    const rawStart = Math.min(...times);
    const rawEnd = Math.max(...times);
    const { startMs, endMs } = roundHalfHourRange(rawStart, rawEnd);

    const res = await fetchWithTimeout(
      "/api/events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time: new Date(startMs).toISOString(),
          end_time: new Date(endMs).toISOString(),
          property_id: null,
          deal_id: null,
          event_type: null,
        }),
      },
      MATCH_FETCH_TIMEOUT_MS
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create event");
    return data.event.id as number;
  }

  async function handleUploadAll() {
    setUploading(true);
    let anyUploaded = false;
    let noLocationEventId: number | null = null;
    const noLocationItems = pending.filter((p) => p.status !== "done" && p.selectedPropertyId === NO_LOCATION);

    for (const item of pending) {
      if (item.status === "done" || item.selectedPropertyId === "" || item.selectedPropertyId === NEW_PROPERTY) continue;
      setPending((p) => p.map((it) => (it.id === item.id ? { ...it, status: "uploading" } : it)));
      try {
        let target: UploadTarget;
        if (item.selectedPropertyId === NO_LOCATION) {
          if (noLocationEventId == null) noLocationEventId = await createNoLocationBatchEvent(noLocationItems);
          target = { kind: "event", eventId: noLocationEventId };
        } else {
          target = { kind: "property", propertyId: item.selectedPropertyId };
        }

        if (item.mediaType === "video") {
          await uploadVideoItem(item, target);
        } else {
          await uploadPhotoItem(item, target);
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

  const readyCount = pending.filter(
    (p) => p.status !== "done" && p.selectedPropertyId !== "" && p.selectedPropertyId !== NEW_PROPERTY
  ).length;
  const allResolved = pending.every((p) => p.status !== "matching");

  const dominantMatch = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of pending) {
      if (typeof item.selectedPropertyId === "number") {
        counts.set(item.selectedPropertyId, (counts.get(item.selectedPropertyId) ?? 0) + 1);
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

    const matched = pending.flatMap((p) => p.candidates).find((c) => c.id === bestId);
    const option = propertyOptions.find((p) => p.id === bestId);
    const label = matched ? formatPropertyLabel(matched) : option ? formatPropertyLabel(option) : `Property #${bestId}`;
    return { id: bestId, label, count: bestCount };
  }, [pending, propertyOptions]);

  function setAllToProperty(propertyId: number) {
    setPending((p) => p.map((it) => (it.status === "done" ? it : { ...it, selectedPropertyId: propertyId })));
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
      <button type="button" className={styles["nav-btn"]} onClick={handlePasteClick} disabled={pasting}>
        {pasting ? "Pasting…" : "📋 Paste Photo"}
      </button>
      {pasteError && <div className={styles["paste-error"]}>{pasteError}</div>}

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
                  GPS location suggests a matching property for photos — videos need a property picked manually.
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
                  <strong>{dominantMatch.label}</strong>
                </span>
                <button
                  type="button"
                  className={styles["bulk-match-btn"]}
                  disabled={uploading}
                  onClick={() => setAllToProperty(dominantMatch.id)}
                >
                  Set all {pending.length} to this property
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
                          <div className={styles["upload-status"]}>Video — choose a property.</div>
                        )}
                        {item.mediaType === "photo" && !item.gps && (
                          <div className={styles["upload-status"]}>No location data — choose a property.</div>
                        )}
                        {item.mediaType === "photo" && item.gps && item.candidates.length === 0 && (
                          <div className={styles["upload-status"]}>No nearby property found — choose one.</div>
                        )}
                        {item.mediaType === "photo" && item.gps && item.candidates.length > 0 && (
                          <div className={styles["upload-status"]}>
                            Best match: {formatPropertyLabel(item.candidates[0])} · {distanceLabel(item.candidates[0].distanceMeters)}
                          </div>
                        )}
                        <select
                          className={styles["upload-select"]}
                          value={item.selectedPropertyId}
                          disabled={item.status === "uploading" || item.status === "done"}
                          onChange={(e) => {
                            const value = e.target.value;
                            const next: PropertySelection =
                              value === NEW_PROPERTY ? NEW_PROPERTY : value === NO_LOCATION ? NO_LOCATION : value ? Number(value) : "";
                            setPending((p) => p.map((it) => (it.id === item.id ? { ...it, selectedPropertyId: next } : it)));
                          }}
                        >
                          <option value="">Select a property…</option>
                          <option value={NO_LOCATION}>No Location</option>
                          <option value={NEW_PROPERTY}>+ Add new property…</option>
                          {item.candidates.length > 0 && (
                            <optgroup label="Nearby matches">
                              {item.candidates.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {formatPropertyLabel(c)} — {distanceLabel(c.distanceMeters)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="All properties">
                            {propertyOptions.map((p) => (
                              <option key={p.id} value={p.id}>
                                {formatPropertyLabel(p)}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {item.selectedPropertyId === NEW_PROPERTY && (
                          <div className={styles["new-property-row"]}>
                            <input
                              type="text"
                              className={styles["new-property-input"]}
                              placeholder="New property address"
                              value={item.newPropertyAddress}
                              disabled={item.creatingProperty}
                              onChange={(e) =>
                                setPending((p) =>
                                  p.map((it) => (it.id === item.id ? { ...it, newPropertyAddress: e.target.value } : it))
                                )
                              }
                            />
                            <button
                              type="button"
                              className={styles["bulk-match-btn"]}
                              disabled={item.creatingProperty || !item.newPropertyAddress.trim()}
                              onClick={() => createProperty(item)}
                            >
                              {item.creatingProperty ? "Adding…" : "Add"}
                            </button>
                          </div>
                        )}
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
