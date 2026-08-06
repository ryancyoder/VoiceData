"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "./photos.module.css";
import { dealPhotoUrl, dealThumbUrl, formatPropertyLabel, type DealPhoto } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { readClientExif } from "@/lib/clientExif";
import { compressImage } from "@/lib/compressImage";

const UPLOAD_TIMEOUT_MS = 60000;

export interface GalleryEvent {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  event_type: EventType | null;
  photos: DealPhoto[];
  dealId: number | null;
  dealName: string | null;
  dealCompany: string | null;
  dealStage: string | null;
  propertyId: number | null;
  propertyAddress: string | null;
  propertyContactLastName: string | null;
  propertyCoverPhotoId: number | null;
}

interface DealGroup {
  dealId: number | null;
  dealName: string;
  dealStage: string | null;
  events: GalleryEvent[];
}

interface PropertyGroup {
  key: string;
  propertyId: number | null;
  propertyLabel: string;
  coverPhotoId: number | null;
  deals: DealGroup[];
}

function flattenPropertyPhotos(property: PropertyGroup): DealPhoto[] {
  return property.deals.flatMap((d) => d.events.flatMap((e) => e.photos));
}

function propertyKey(propertyId: number | null): string {
  return propertyId != null ? String(propertyId) : "none";
}

export default function PhotoGalleryClient({ events: initialEvents }: { events: GalleryEvent[] }) {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<GalleryEvent[]>(initialEvents);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Optimistic overlay on top of the property's stored cover_photo_id —
  // keyed by property key rather than folded into `events`, since the
  // cover choice lives on the property row, not any individual event.
  const [coverOverrides, setCoverOverrides] = useState<Map<string, number | null>>(new Map());
  const scrollTargetDealId = useRef<number | null>(null);
  const [uploadingEventId, setUploadingEventId] = useState<number | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState<{ eventId: number; message: string } | null>(null);
  const pasteTargetRef = useRef<HTMLTextAreaElement>(null);
  // Which event (if any) a bare ⌘V should be treated as "add a photo to" —
  // several event groups can be on screen at once here, unlike a single-
  // section modal, so paste only ever acts once a specific event's Paste
  // button has set this; an unarmed paste is left alone entirely.
  const pasteArmedEventIdRef = useRef<number | null>(null);

  const propertyGroups = useMemo(() => {
    const propMap = new Map<
      string,
      { propertyId: number | null; propertyLabel: string; coverPhotoId: number | null; dealMap: Map<string, DealGroup> }
    >();
    for (const event of events) {
      if (event.photos.length === 0) continue;
      const pKey = propertyKey(event.propertyId);
      if (!propMap.has(pKey)) {
        propMap.set(pKey, {
          propertyId: event.propertyId,
          propertyLabel: event.propertyAddress
            ? formatPropertyLabel({ address: event.propertyAddress, contactLastName: event.propertyContactLastName })
            : "No property",
          coverPhotoId: event.propertyCoverPhotoId,
          dealMap: new Map(),
        });
      }
      const propGroup = propMap.get(pKey)!;
      const dKey = event.dealId != null ? String(event.dealId) : "none";
      if (!propGroup.dealMap.has(dKey)) {
        propGroup.dealMap.set(dKey, {
          dealId: event.dealId,
          dealName: event.dealName ?? "No deal yet",
          dealStage: event.dealStage,
          events: [],
        });
      }
      propGroup.dealMap.get(dKey)!.events.push(event);
    }
    return Array.from(propMap.entries())
      .map(([key, p]) => ({
        key,
        propertyId: p.propertyId,
        propertyLabel: p.propertyLabel,
        coverPhotoId: coverOverrides.has(key) ? coverOverrides.get(key)! : p.coverPhotoId,
        deals: Array.from(p.dealMap.values()),
      }))
      .sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel));
  }, [events, coverOverrides]);

  const totalPhotoCount = useMemo(
    () => propertyGroups.reduce((n, p) => n + flattenPropertyPhotos(p).length, 0),
    [propertyGroups]
  );

  const [activePropertyKey, setActivePropertyKey] = useState<string | null>(() => {
    const dealParam = searchParams.get("deal");
    const dealId = dealParam ? Number(dealParam) : NaN;
    if (!Number.isFinite(dealId)) return null;
    const match = initialEvents.find((e) => e.dealId === dealId && e.photos.length > 0);
    return match ? propertyKey(match.propertyId) : null;
  });

  // Scrolling to the linked-from deal's section is a side effect, not part
  // of render — done once on mount, after the initial property (if any) is
  // already open.
  useEffect(() => {
    const dealParam = searchParams.get("deal");
    const dealId = dealParam ? Number(dealParam) : NaN;
    if (Number.isFinite(dealId)) scrollTargetDealId.current = dealId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProperty = activePropertyKey != null ? propertyGroups.find((p) => p.key === activePropertyKey) ?? null : null;
  // Lightbox prev/next navigates this flat list, ordered the same way the
  // grid below renders it: deal by deal, then event by event within a deal.
  const activePhotos = useMemo(() => (activeProperty ? flattenPropertyPhotos(activeProperty) : []), [activeProperty]);
  const activePhoto: DealPhoto | null = activeIndex != null ? activePhotos[activeIndex] ?? null : null;

  useEffect(() => {
    if (!scrollTargetDealId.current || !activeProperty) return;
    const id = scrollTargetDealId.current;
    scrollTargetDealId.current = null;
    requestAnimationFrame(() => {
      document.querySelector(`[data-deal-group="${id}"]`)?.scrollIntoView({ block: "start" });
    });
  }, [activeProperty]);

  useEffect(() => {
    if (activeIndex == null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setActiveIndex(null);
      else if (e.key === "ArrowLeft") setActiveIndex((i) => (i != null ? Math.max(0, i - 1) : i));
      else if (e.key === "ArrowRight") setActiveIndex((i) => (i != null ? Math.min(activePhotos.length - 1, i + 1) : i));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, activePhotos.length]);

  function openAlbum(key: string) {
    setActivePropertyKey(key);
    setActiveIndex(null);
  }

  function backToAlbums() {
    setActivePropertyKey(null);
    setActiveIndex(null);
  }

  async function handleDelete(photo: DealPhoto) {
    setDeletingId(photo.id);
    try {
      const res = await fetch(`/api/photos/${photo.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete photo");
      setEvents((es) => es.map((e) => ({ ...e, photos: e.photos.filter((p) => p.id !== photo.id) })));
      if (activePhoto?.id === photo.id) setActiveIndex(null);
      if (activeProperty && flattenPropertyPhotos(activeProperty).length <= 1) {
        setActivePropertyKey(null);
        setActiveIndex(null);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete photo");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSetCover(property: PropertyGroup, photoId: number | null) {
    if (property.propertyId == null) return; // no property row to attach a cover to
    const propertyId = property.propertyId;
    const previous = coverOverrides.get(property.key) ?? null;
    setCoverOverrides((m) => new Map(m).set(property.key, photoId));
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_photo_id: photoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set cover photo");
    } catch (err) {
      setCoverOverrides((m) => new Map(m).set(property.key, previous));
      alert(err instanceof Error ? err.message : "Failed to set cover photo");
    }
  }

  const uploadPhotoToEvent = useCallback(async (eventId: number, file: File) => {
    const { gps, takenAt } = await readClientExif(file);
    const uploadFile = await compressImage(file);

    const formData = new FormData();
    formData.append("file", uploadFile);
    if (gps) {
      formData.append("latitude", String(gps.latitude));
      formData.append("longitude", String(gps.longitude));
    }
    if (takenAt) formData.append("takenAt", takenAt);

    const res = await fetchWithTimeout(`/api/events/${eventId}/photos`, { method: "POST", body: formData }, UPLOAD_TIMEOUT_MS);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");

    const photo = data.photo as DealPhoto;
    setEvents((es) => es.map((e) => (e.id === eventId ? { ...e, photos: [...e.photos, photo] } : e)));
  }, []);

  const uploadFilesToEvent = useCallback(
    async (eventId: number, files: File[]) => {
      if (files.length === 0) return;
      setUploadingEventId(eventId);
      setPasteFeedback(null);
      try {
        for (const file of files) await uploadPhotoToEvent(eventId, file);
      } catch (err) {
        setPasteFeedback({ eventId, message: err instanceof Error ? err.message : "Upload failed" });
      } finally {
        setUploadingEventId(null);
      }
    },
    [uploadPhotoToEvent]
  );

  function armPasteForEvent(eventId: number) {
    pasteArmedEventIdRef.current = eventId;
    pasteTargetRef.current?.focus();
  }

  async function handlePasteButtonClick(eventId: number) {
    setPasteFeedback(null);
    if (!navigator.clipboard?.read) {
      setPasteFeedback({ eventId, message: "Press ⌘V / Ctrl+V now to paste" });
      armPasteForEvent(eventId);
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      const typesSeen: string[] = [];
      for (const clipboardItem of clipboardItems) {
        typesSeen.push(...clipboardItem.types);
        const imageType = clipboardItem.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await clipboardItem.getType(imageType);
        const ext = imageType.split("/")[1] || "png";
        files.push(new File([blob], `pasted-${Date.now()}.${ext}`, { type: imageType }));
      }
      if (files.length === 0) {
        setPasteFeedback({
          eventId,
          message:
            typesSeen.length > 0
              ? `Press ⌘V / Ctrl+V now to paste (clipboard.read() only saw: ${typesSeen.join(", ")})`
              : "Press ⌘V / Ctrl+V now to paste",
        });
        armPasteForEvent(eventId);
        return;
      }
      await uploadFilesToEvent(eventId, files);
    } catch {
      setPasteFeedback({ eventId, message: "Press ⌘V / Ctrl+V now to paste" });
      armPasteForEvent(eventId);
    }
  }

  // Only acts when a specific event's Paste button armed this — several
  // event groups can be open at once, so a bare paste with no armed target
  // is left alone rather than guessing which one it was meant for.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const eventId = pasteArmedEventIdRef.current;
      if (eventId == null) return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length === 0) {
        const seen = Array.from(items).map((item) => `${item.kind}:${item.type || "(no type)"}`).join(", ");
        setPasteFeedback({ eventId, message: `No image found in what was pasted (found: ${seen})` });
        return;
      }
      e.preventDefault();
      pasteArmedEventIdRef.current = null;
      setPasteFeedback(null);
      uploadFilesToEvent(eventId, files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [uploadFilesToEvent]);

  return (
    <div className={styles.gallery}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <h1>Photo Gallery</h1>
          <p>
            {activeProperty ? (
              <>
                <button type="button" className={styles["back-link"]} onClick={backToAlbums}>
                  ‹ All albums
                </button>{" "}
                · {activeProperty.propertyLabel}
              </>
            ) : (
              <>
                {propertyGroups.length} album{propertyGroups.length === 1 ? "" : "s"} · {totalPhotoCount} photo
                {totalPhotoCount === 1 ? "" : "s"}
              </>
            )}{" "}
            ·{" "}
            <Link href="/calendar" className={styles["brand-back"]}>
              Calendar
            </Link>{" "}
            ·{" "}
            <Link href="/properties" className={styles["brand-back"]}>
              Properties
            </Link>{" "}
            ·{" "}
            <Link href="/sales-board" className={styles["brand-back"]}>
              ← Sales Board
            </Link>
          </p>
        </div>
      </div>

      <div className={styles.content}>
        {propertyGroups.length === 0 ? (
          <div className={styles.empty}>
            No photos have been uploaded yet. Add photos from the Calendar or a deal&apos;s detail view.
          </div>
        ) : !activeProperty ? (
          <div className={styles.grid}>
            {propertyGroups.map((property) => {
              const photos = flattenPropertyPhotos(property);
              const cover = photos.find((p) => p.id === property.coverPhotoId) ?? photos[0];
              const coverThumb = dealThumbUrl(cover);
              const dealCount = property.deals.filter((d) => d.dealId != null).length;
              return (
                <button key={property.key} type="button" className={styles.album} onClick={() => openAlbum(property.key)}>
                  <span className={styles["thumb-image-wrap"]}>
                    {coverThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverThumb} alt={cover.caption ?? property.propertyLabel} loading="lazy" />
                    ) : (
                      <span className={styles["thumb-placeholder"]}>🎬</span>
                    )}
                    <span className={styles["album-badge"]}>
                      {photos.length} photo{photos.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className={styles["thumb-caption"]}>
                    <span className={styles["thumb-caption-name"]}>{property.propertyLabel}</span>
                    <span className={styles["thumb-caption-stage"]}>
                      {dealCount} deal{dealCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          (() => {
            let runningIndex = -1;
            return (
              <div className={styles["deal-groups"]}>
                <textarea
                  ref={pasteTargetRef}
                  className={styles["paste-target"]}
                  aria-hidden="true"
                  tabIndex={-1}
                  value=""
                  onChange={() => {}}
                />
                {activeProperty.deals.map((deal) => (
                  <div key={deal.dealId ?? "none"} className={styles["deal-group"]} data-deal-group={deal.dealId ?? undefined}>
                    <div className={styles["deal-group-header"]}>
                      <span className={styles["deal-group-name"]}>{deal.dealName}</span>
                      {deal.dealStage && <span className={styles["thumb-caption-stage"]}>{deal.dealStage}</span>}
                    </div>
                    <div className={styles["event-groups"]}>
                      {deal.events
                        .filter((event) => event.photos.length > 0)
                        .map((event) => (
                          <div key={event.id} className={styles["event-group"]} data-event-group={event.id}>
                            <div className={styles["event-group-header"]}>
                              {event.event_type && <span className={styles["event-type-badge"]}>{event.event_type}</span>}
                              <span className={styles["event-group-name"]}>{event.name ?? "Site visit"}</span>
                              <span className={styles["event-group-date"]}>
                                {new Date(event.start_time).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                              <span className={styles["event-add-actions"]}>
                                <label className={styles["event-add-btn"]}>
                                  + Add
                                  <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    disabled={uploadingEventId === event.id}
                                    onChange={(e) => {
                                      const files = e.target.files ? Array.from(e.target.files) : [];
                                      e.target.value = "";
                                      if (files.length > 0) uploadFilesToEvent(event.id, files);
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  className={styles["event-paste-btn"]}
                                  disabled={uploadingEventId === event.id}
                                  onClick={() => handlePasteButtonClick(event.id)}
                                >
                                  📋 Paste
                                </button>
                                {uploadingEventId === event.id && (
                                  <span className={styles["event-upload-status"]}>Uploading…</span>
                                )}
                              </span>
                            </div>
                            {pasteFeedback && pasteFeedback.eventId === event.id && (
                              <div className={styles["event-paste-error"]}>{pasteFeedback.message}</div>
                            )}
                            <div className={styles.grid}>
                              {event.photos.map((photo) => {
                                runningIndex += 1;
                                const i = runningIndex;
                                const thumbUrl = dealThumbUrl(photo);
                                return (
                                  <div key={photo.id} className={styles.thumb}>
                                    <button type="button" className={styles["thumb-open"]} onClick={() => setActiveIndex(i)}>
                                      <span className={styles["thumb-image-wrap"]}>
                                        {thumbUrl ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={thumbUrl} alt={photo.caption ?? deal.dealName} loading="lazy" />
                                        ) : (
                                          <span className={styles["thumb-placeholder"]}>🎬</span>
                                        )}
                                        {photo.media_type === "video" && <span className={styles["video-badge"]}>▶</span>}
                                        {photo.is_outlier && (
                                          <span
                                            className={styles["outlier-badge"]}
                                            title="Dated differently than the rest of this event"
                                          >
                                            ⚠
                                          </span>
                                        )}
                                      </span>
                                    </button>
                                    {activeProperty.propertyId != null && (
                                      <button
                                        type="button"
                                        className={`${styles["thumb-cover"]} ${photo.id === activeProperty.coverPhotoId ? styles["is-cover"] : ""}`}
                                        aria-label={photo.id === activeProperty.coverPhotoId ? "Unset as cover photo" : "Set as cover photo"}
                                        title={photo.id === activeProperty.coverPhotoId ? "Cover photo — click to unset" : "Set as cover photo"}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSetCover(activeProperty, photo.id === activeProperty.coverPhotoId ? null : photo.id);
                                        }}
                                      >
                                        {photo.id === activeProperty.coverPhotoId ? "★" : "☆"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className={styles["thumb-delete"]}
                                      aria-label="Delete photo"
                                      disabled={deletingId === photo.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(photo);
                                      }}
                                    >
                                      ×
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>

      {activeProperty && activePhoto && (
        <div
          className={styles["lightbox-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveIndex(null);
          }}
        >
          <div className={styles["lightbox-panel"]}>
            <div className={styles["lightbox-image-wrap"]}>
              {activePhoto.media_type === "video" ? (
                <video
                  key={activePhoto.id}
                  src={dealPhotoUrl(activePhoto.storage_path)}
                  poster={activePhoto.poster_path ? dealPhotoUrl(activePhoto.poster_path) : undefined}
                  controls
                  autoPlay
                  className={styles["lightbox-video"]}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dealPhotoUrl(activePhoto.storage_path)} alt={activePhoto.caption ?? activeProperty.propertyLabel} />
              )}
            </div>
            <div className={styles["lightbox-head"]}>
              <div className={styles["lightbox-head-main"]}>
                <div className={styles["lightbox-title"]}>{activeProperty.propertyLabel}</div>
              </div>
              <div className={styles["lightbox-actions"]}>
                <button
                  type="button"
                  className={styles["lightbox-nav"]}
                  disabled={activeIndex === 0}
                  onClick={() => setActiveIndex((i) => (i != null ? Math.max(0, i - 1) : i))}
                >
                  ‹ Prev
                </button>
                <button
                  type="button"
                  className={styles["lightbox-nav"]}
                  disabled={activeIndex === activePhotos.length - 1}
                  onClick={() => setActiveIndex((i) => (i != null ? Math.min(activePhotos.length - 1, i + 1) : i))}
                >
                  Next ›
                </button>
                {activeProperty.propertyId != null && (
                  <button
                    type="button"
                    className={`${styles["lightbox-cover"]} ${activePhoto.id === activeProperty.coverPhotoId ? styles["is-cover"] : ""}`}
                    onClick={() =>
                      handleSetCover(activeProperty, activePhoto.id === activeProperty.coverPhotoId ? null : activePhoto.id)
                    }
                  >
                    {activePhoto.id === activeProperty.coverPhotoId ? "★ Cover photo" : "☆ Set as cover"}
                  </button>
                )}
                <button
                  type="button"
                  className={styles["lightbox-delete"]}
                  disabled={deletingId === activePhoto.id}
                  onClick={() => handleDelete(activePhoto)}
                >
                  {deletingId === activePhoto.id ? "Deleting…" : "Delete"}
                </button>
                <button type="button" className={styles["lightbox-close"]} aria-label="Close" onClick={() => setActiveIndex(null)}>
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
