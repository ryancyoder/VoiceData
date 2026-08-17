"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "./photos.module.css";
import { ACTION_PHOTO_TYPE, PROPERTY_REFERENCE_TYPE, dealPhotoUrl, dealThumbUrl, formatPropertyLabel, STAGES, WALKTHROUGH_VIDEO_TYPE, type DealPhoto, type Stage } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { readClientExif } from "@/lib/clientExif";
import { compressImage } from "@/lib/compressImage";
import { usePersistentState } from "@/lib/usePersistentState";
import PhotoAnnotator from "@/components/PhotoAnnotator";
import EstimateGroupLinker from "./EstimateGroupLinker";
import { refEventId } from "./refEventId";

const UPLOAD_TIMEOUT_MS = 60000;

const STAGE_COLORS: Record<Stage, string> = {
  Lead: "var(--c-lead)",
  Propose: "var(--c-propose)",
  Sent: "var(--c-send)",
  Sold: "var(--c-sold)",
  "Project Management": "var(--c-pm)",
  Invoiced: "var(--c-invoiced)",
  "Paid in Full": "var(--c-paid)",
};

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
  // The deal's ⚡ next-action photo (a deal_photos id), or null. Next-action
  // photos are per-deal now, not per-property — synthetic reference groups
  // (which have no deal) carry null.
  dealNextActionPhotoId: number | null;
  // A synthetic group holding a deal's event-less Site_Plan_Image photos
  // (uploaded from the estimator). Rendered with a SITE PLAN badge and no
  // calendar link / add controls, since it isn't a real calendar event.
  isSitePlan?: boolean;
  // A synthetic group holding a property's event-less general-reference photos.
  // Rendered under a "General reference" section with its own uploader.
  isPropertyReference?: boolean;
  // A synthetic group holding a deal's event-less next-action photo(s), uploaded
  // from the Next Actions list. Rendered under an "Action" section.
  isActionSection?: boolean;
}

interface DealGroup {
  dealId: number | null;
  dealName: string;
  dealStage: string | null;
  // The deal's ⚡ next-action photo (a deal_photos id), or null. Only real
  // deals (dealId != null) can carry one.
  nextActionPhotoId: number | null;
  events: GalleryEvent[];
}

interface PropertyGroup {
  key: string;
  propertyId: number | null;
  propertyLabel: string;
  coverPhotoId: number | null;
  referencePhotos: DealPhoto[];
  deals: DealGroup[];
}

function flattenPropertyPhotos(property: PropertyGroup): DealPhoto[] {
  // Reference photos come first so they line up with the render order (the
  // General reference section is drawn above the deal groups).
  return [...property.referencePhotos, ...property.deals.flatMap((d) => d.events.flatMap((e) => e.photos))];
}

function propertyKey(propertyId: number | null): string {
  return propertyId != null ? String(propertyId) : "none";
}

export default function PhotoGalleryClient({ events: initialEvents }: { events: GalleryEvent[] }) {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<GalleryEvent[]>(initialEvents);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [annotating, setAnnotating] = useState<DealPhoto | null>(null);
  const [linkingPhoto, setLinkingPhoto] = useState<DealPhoto | null>(null);
  // The take-off groups the open photo is linked to, with their live
  // dimensions — overlaid on the front of the photo in the lightbox.
  const [activeTakeoff, setActiveTakeoff] = useState<
    { id: string; label: string; sqFt: number; linearFt: number; height: number }[]
  >([]);
  // The estimate the open photo belongs to, so we can jump into the estimator.
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<number | null>(null);
  // Overlay captions on the fronts of the images — a viewing preference,
  // persisted per browser.
  const [showCaptions, setShowCaptions] = useState(false);
  const [bigTiles, setBigTiles] = usePersistentState("photos.bigTiles", false);
  // Deal whose Action section is currently a drag-over drop target (for the
  // "drag a photo into the Action section to make it the next action" gesture).
  const [dragOverDealId, setDragOverDealId] = useState<number | null>(null);
  // Whether the General reference section is currently a drag-over drop target.
  const [dragOverReference, setDragOverReference] = useState(false);
  // Event currently a drag-over drop target (for moving a filed photo back into it).
  const [dragOverEventId, setDragOverEventId] = useState<number | null>(null);
  const [savingCaptionId, setSavingCaptionId] = useState<number | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  // Optimistic overlay on top of the property's stored cover_photo_id —
  // keyed by property key rather than folded into `events`, since the
  // cover choice lives on the property row, not any individual event.
  const [coverOverrides, setCoverOverrides] = useState<Map<string, number | null>>(new Map());
  // Optimistic overlay of a deal's next-action photo id (keyed by deal id) so
  // the ⚡ badge updates the moment a jobsite photo is marked, before the
  // server moves it into the Action section on the next load.
  const [nextActionOverrides, setNextActionOverrides] = useState<Map<number, number | null>>(new Map());
  const scrollTargetDealId = useRef<number | null>(null);
  // A ?photo=<id> deep link: pop this photo's lightbox once its album opens.
  const openPhotoTargetId = useRef<number | null>(null);
  const [uploadingEventId, setUploadingEventId] = useState<number | null>(null);
  const [uploadingPropertyId, setUploadingPropertyId] = useState<number | null>(null);
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
      { propertyId: number | null; propertyLabel: string; coverPhotoId: number | null; referencePhotos: DealPhoto[]; dealMap: Map<string, DealGroup> }
    >();
    for (const event of events) {
      if (event.photos.length === 0 && !event.isPropertyReference) continue;
      const pKey = propertyKey(event.propertyId);
      if (!propMap.has(pKey)) {
        propMap.set(pKey, {
          propertyId: event.propertyId,
          propertyLabel: event.propertyAddress
            ? formatPropertyLabel({ address: event.propertyAddress, contactLastName: event.propertyContactLastName })
            : "No property",
          coverPhotoId: event.propertyCoverPhotoId,
          referencePhotos: [],
          dealMap: new Map(),
        });
      }
      const propGroup = propMap.get(pKey)!;
      // General-reference photos attach to the property, not any deal/event.
      if (event.isPropertyReference) {
        propGroup.referencePhotos.push(...event.photos);
        if (event.propertyAddress && propGroup.propertyLabel === "No property") {
          propGroup.propertyLabel = formatPropertyLabel({ address: event.propertyAddress, contactLastName: event.propertyContactLastName });
        }
        continue;
      }
      const dKey = event.dealId != null ? String(event.dealId) : "none";
      if (!propGroup.dealMap.has(dKey)) {
        propGroup.dealMap.set(dKey, {
          dealId: event.dealId,
          dealName: event.dealName ?? "No deal yet",
          dealStage: event.dealStage,
          nextActionPhotoId: event.dealNextActionPhotoId,
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
        referencePhotos: p.referencePhotos,
        deals: Array.from(p.dealMap.values()).map((d) =>
          d.dealId != null && nextActionOverrides.has(d.dealId)
            ? { ...d, nextActionPhotoId: nextActionOverrides.get(d.dealId)! }
            : d
        ),
      }))
      .sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel));
  }, [events, coverOverrides, nextActionOverrides]);

  const totalPhotoCount = useMemo(
    () => propertyGroups.reduce((n, p) => n + flattenPropertyPhotos(p).length, 0),
    [propertyGroups]
  );

  // Same model as the Properties page filter: all stages selected is the
  // neutral/unfiltered state (every album shows, including ones with no
  // deal at all yet); deselecting a stage narrows to albums that have a
  // deal in one of the stages still selected.
  const [selectedStages, setSelectedStages] = useState<Set<Stage>>(() => new Set(STAGES));
  function toggleStage(stage: Stage) {
    setSelectedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }
  const visiblePropertyGroups = useMemo(() => {
    if (selectedStages.size === STAGES.length) return propertyGroups;
    return propertyGroups.filter((p) =>
      p.deals.some((d) => d.dealStage != null && selectedStages.has(d.dealStage as Stage))
    );
  }, [propertyGroups, selectedStages]);

  const [activePropertyKey, setActivePropertyKey] = useState<string | null>(() => {
    // ?photo=<id> opens the album that contains a specific photo and (via the
    // effect below) pops its lightbox — used to jump here from the estimator.
    const photoParam = searchParams.get("photo");
    const targetPhotoId = photoParam ? Number(photoParam) : NaN;
    if (Number.isFinite(targetPhotoId)) {
      const match = initialEvents.find((e) => e.photos.some((p) => p.id === targetPhotoId));
      if (match) return propertyKey(match.propertyId);
    }
    // ?property=<id> opens that property's album directly (used by the global
    // command palette's "Photo albums" results).
    const propertyParam = searchParams.get("property");
    const propertyId = propertyParam ? Number(propertyParam) : NaN;
    if (Number.isFinite(propertyId)) {
      const match = initialEvents.find((e) => e.propertyId === propertyId && e.photos.length > 0);
      if (match) return propertyKey(propertyId);
    }
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
    const photoParam = searchParams.get("photo");
    const photoId = photoParam ? Number(photoParam) : NaN;
    if (Number.isFinite(photoId)) openPhotoTargetId.current = photoId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProperty = activePropertyKey != null ? propertyGroups.find((p) => p.key === activePropertyKey) ?? null : null;
  // Lightbox prev/next navigates this flat list, ordered the same way the
  // grid below renders it: deal by deal, then event by event within a deal.
  const activePhotos = useMemo(() => (activeProperty ? flattenPropertyPhotos(activeProperty) : []), [activeProperty]);
  const activePhoto: DealPhoto | null = activeIndex != null ? activePhotos[activeIndex] ?? null : null;
  // Which deal each photo in the open album belongs to — lets the lightbox offer
  // "set as next action" on a deal's photos.
  const dealByPhotoId = useMemo(() => {
    const map = new Map<number, DealGroup>();
    if (!activeProperty) return map;
    for (const deal of activeProperty.deals) {
      if (deal.dealId == null) continue;
      for (const event of deal.events) for (const photo of event.photos) map.set(photo.id, deal);
    }
    return map;
  }, [activeProperty]);
  const activePhotoDeal = activePhoto ? dealByPhotoId.get(activePhoto.id) ?? null : null;

  // Once the target album is open, pop the deep-linked photo's lightbox.
  useEffect(() => {
    if (openPhotoTargetId.current == null || activePhotos.length === 0) return;
    const idx = activePhotos.findIndex((p) => p.id === openPhotoTargetId.current);
    openPhotoTargetId.current = null;
    if (idx >= 0) setActiveIndex(idx);
  }, [activePhotos]);

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

  // Keep the lightbox caption editor in sync with whichever photo is open.
  useEffect(() => {
    setCaptionDraft(activePhoto?.caption ?? "");
  }, [activePhoto?.id]);

  // Fetch the linked take-off groups (and their live dimensions) for the open
  // photo, so we can overlay the measurements on the front of the image.
  useEffect(() => {
    const id = activePhoto?.id;
    if (id == null) {
      setActiveTakeoff([]);
      setActiveEstimateId(null);
      return;
    }
    let cancelled = false;
    setActiveTakeoff([]);
    setActiveEstimateId(null);
    (async () => {
      try {
        const res = await fetch(`/api/photos/${id}/estimate-groups`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const linked = new Set<string>(Array.isArray(data.linkedGroupIds) ? data.linkedGroupIds : []);
        const groups = (Array.isArray(data.groups) ? data.groups : []).filter(
          (g: { id: string }) => linked.has(g.id),
        );
        setActiveTakeoff(groups);
        // Only offer the jump when the photo is actually linked to a take-off.
        setActiveEstimateId(groups.length > 0 ? (data.estimateId ?? null) : null);
      } catch {
        /* leave empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePhoto?.id]);

  function openAlbum(key: string) {
    setActivePropertyKey(key);
    setActiveIndex(null);
  }

  function backToAlbums() {
    setActivePropertyKey(null);
    setActiveIndex(null);
  }

  useEffect(() => {
    try {
      setShowCaptions(localStorage.getItem("gallery-show-captions") === "1");
    } catch {
      /* no persisted preference */
    }
  }, []);

  function toggleCaptions() {
    setShowCaptions((v) => {
      const next = !v;
      try {
        localStorage.setItem("gallery-show-captions", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function saveCaption(photo: DealPhoto, raw: string) {
    const caption = raw.trim() || null;
    if (caption === (photo.caption ?? null)) return;
    setSavingCaptionId(photo.id);
    try {
      const res = await fetch(`/api/photos/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption }),
      });
      if (!res.ok) throw new Error("Failed to save caption");
      setEvents((es) => es.map((e) => ({ ...e, photos: e.photos.map((p) => (p.id === photo.id ? { ...p, caption } : p)) })));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save caption");
    } finally {
      setSavingCaptionId(null);
    }
  }

  // Fold a server-returned photo (after annotate or revert) back into the
  // events tree in place — its storage_path changes, so the thumbnail and
  // lightbox re-point at the new file automatically.
  function applyPhotoUpdate(updated: DealPhoto) {
    setEvents((es) => es.map((e) => ({ ...e, photos: e.photos.map((p) => (p.id === updated.id ? updated : p)) })));
  }

  async function handleRevert(photo: DealPhoto) {
    // No native confirm() here — it's unreliable in an iOS standalone PWA
    // (returns false without showing a dialog), which silently blocked revert.
    // The original is preserved server-side, so the annotation can be redone.
    setRevertingId(photo.id);
    try {
      const res = await fetch(`/api/photos/${photo.id}/annotate`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revert photo");
      applyPhotoUpdate(data.photo as DealPhoto);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revert photo");
    } finally {
      setRevertingId(null);
    }
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

  // Find a photo in the open album by id.
  function findPhotoInAlbum(photoId: number): DealPhoto | null {
    if (!activeProperty) return null;
    for (const p of activeProperty.referencePhotos) if (p.id === photoId) return p;
    for (const deal of activeProperty.deals)
      for (const event of deal.events) for (const p of event.photos) if (p.id === photoId) return p;
    return null;
  }

  // Optimistically relocate a photo to another group in local state, so a
  // dropped photo appears in its new home without waiting for a reload. Removes
  // it from wherever it is, then adds it to the target group (creating that
  // group via `createTarget` if it isn't present yet).
  function stateRelocatePhoto(
    photoId: number,
    targetEventId: number,
    moved: DealPhoto,
    createTarget?: () => GalleryEvent
  ) {
    setEvents((evs) => {
      const cleared = evs.map((ev) =>
        ev.photos.some((p) => p.id === photoId)
          ? { ...ev, photos: ev.photos.filter((p) => p.id !== photoId) }
          : ev
      );
      if (cleared.some((ev) => ev.id === targetEventId)) {
        return cleared.map((ev) => (ev.id === targetEventId ? { ...ev, photos: [...ev.photos, moved] } : ev));
      }
      const created = createTarget?.();
      return created ? [...cleared, created] : cleared;
    });
  }

  function stateMovePhotoToAction(photoId: number, deal: DealGroup, moved: DealPhoto) {
    const property = activeProperty;
    stateRelocatePhoto(photoId, -1_000_000 - (deal.dealId ?? 0), moved, () => ({
      id: -1_000_000 - (deal.dealId ?? 0),
      name: "Next action",
      start_time: moved.created_at,
      end_time: moved.created_at,
      event_type: null,
      isActionSection: true,
      photos: [moved],
      dealId: deal.dealId ?? null,
      dealName: deal.dealName,
      dealCompany: null,
      dealStage: deal.dealStage,
      propertyId: property?.propertyId ?? null,
      propertyAddress: null,
      propertyContactLastName: null,
      propertyCoverPhotoId: property?.coverPhotoId ?? null,
      dealNextActionPhotoId: deal.nextActionPhotoId,
    }));
  }

  // Dropping a photo onto a deal's Action section adds it as an action (a new
  // task) — NOT the next action. Its caption becomes the task title; if it has
  // none, prompt for one.
  async function handleDropOnAction(e: DragEvent, deal: DealGroup) {
    e.preventDefault();
    setDragOverDealId(null);
    if (deal.dealId == null) return;
    const photoId = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isNaN(photoId)) return;
    const photo = findPhotoInAlbum(photoId);
    if (!photo) return;
    // Already one of this deal's action photos — dropping on its own section is a no-op.
    if (photo.photo_type === ACTION_PHOTO_TYPE && photo.deal_id === deal.dealId) return;
    let title = photo.caption?.trim() ?? "";
    if (!title) {
      const entered = window.prompt("Caption for this action (used as its task title):");
      if (entered == null) return; // cancelled
      title = entered.trim();
    }
    try {
      const res = await fetch(`/api/sales-board/${deal.dealId}/next-action-photo/from-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_photo_id: photoId, title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add action");
      stateMovePhotoToAction(photoId, deal, data.photo as DealPhoto);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add action");
    }
  }

  // The ⚡ icon on an action photo promotes it to the deal's next action (or
  // clears it if it already is). Backed by the task's is_next_action flag.
  async function handleToggleNextAction(deal: DealGroup, photo: DealPhoto) {
    if (deal.dealId == null || photo.task_id == null) return;
    const dealId = deal.dealId;
    const makeNext = photo.id !== deal.nextActionPhotoId;
    const previous = deal.nextActionPhotoId;
    setNextActionOverrides((m) => new Map(m).set(dealId, makeNext ? photo.id : null));
    try {
      const res = await fetch(`/api/tasks/${photo.task_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_next_action: makeNext }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to set next action");
      }
    } catch (err) {
      setNextActionOverrides((m) => new Map(m).set(dealId, previous));
      alert(err instanceof Error ? err.message : "Failed to set next action");
    }
  }

  // Optimistically move a photo into the property's General reference section.
  function stateMovePhotoToReference(photoId: number, propertyId: number, moved: DealPhoto) {
    const property = activeProperty;
    stateRelocatePhoto(photoId, refEventId(propertyId), moved, () => ({
      id: refEventId(propertyId),
      name: "General reference",
      start_time: moved.created_at,
      end_time: moved.created_at,
      event_type: null,
      isPropertyReference: true,
      photos: [moved],
      dealId: null,
      dealName: null,
      dealCompany: null,
      dealStage: null,
      propertyId,
      propertyAddress: null,
      propertyContactLastName: null,
      propertyCoverPhotoId: property?.coverPhotoId ?? null,
      dealNextActionPhotoId: null,
    }));
  }

  // Dropping a photo onto the General reference section retags it as an
  // event-less property-reference photo.
  async function handleDropOnReference(e: DragEvent) {
    e.preventDefault();
    setDragOverReference(false);
    const propertyId = activeProperty?.propertyId ?? null;
    if (propertyId == null) return;
    const photoId = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isNaN(photoId)) return;
    const photo = findPhotoInAlbum(photoId);
    if (photo?.photo_type === PROPERTY_REFERENCE_TYPE) return; // already a reference photo
    try {
      const res = await fetch(`/api/properties/${propertyId}/photos/from-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_photo_id: photoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add reference photo");
      stateMovePhotoToReference(photoId, propertyId, data.photo as DealPhoto);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add reference photo");
    }
  }

  // Dropping a filed photo (action / reference) onto a calendar event moves it
  // back into that event as an ordinary photo.
  async function handleDropOnEvent(e: DragEvent, event: GalleryEvent) {
    e.preventDefault();
    setDragOverEventId(null);
    const photoId = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isNaN(photoId) || event.id <= 0) return;
    const photo = findPhotoInAlbum(photoId);
    // Only filed photos (in the Action or General reference sections) move here.
    if (!photo || (photo.photo_type !== ACTION_PHOTO_TYPE && photo.photo_type !== PROPERTY_REFERENCE_TYPE)) return;
    if (photo.event_id === event.id) return;
    try {
      const res = await fetch(`/api/events/${event.id}/photos/from-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_photo_id: photoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to move photo");
      stateRelocatePhoto(photoId, event.id, data.photo as DealPhoto);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to move photo");
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

  // General-reference (property-level, event-less) photo upload.
  const uploadPhotoToProperty = useCallback(async (propertyId: number, coverPhotoId: number | null, file: File) => {
    const { gps, takenAt } = await readClientExif(file);
    const uploadFile = await compressImage(file);
    const formData = new FormData();
    formData.append("file", uploadFile);
    if (gps) {
      formData.append("latitude", String(gps.latitude));
      formData.append("longitude", String(gps.longitude));
    }
    if (takenAt) formData.append("takenAt", takenAt);

    const res = await fetchWithTimeout(`/api/properties/${propertyId}/photos`, { method: "POST", body: formData }, UPLOAD_TIMEOUT_MS);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");

    const photo = data.photo as DealPhoto;
    const evId = refEventId(propertyId);
    setEvents((es) => {
      if (es.some((e) => e.id === evId)) {
        return es.map((e) => (e.id === evId ? { ...e, photos: [...e.photos, photo] } : e));
      }
      // First reference photo for this property — synthesize its group.
      return [
        ...es,
        {
          id: evId,
          name: "General reference",
          start_time: photo.created_at,
          end_time: photo.created_at,
          event_type: null,
          isPropertyReference: true,
          photos: [photo],
          dealId: null,
          dealName: null,
          dealCompany: null,
          dealStage: null,
          propertyId,
          propertyAddress: null,
          propertyContactLastName: null,
          propertyCoverPhotoId: coverPhotoId,
          dealNextActionPhotoId: null,
        },
      ];
    });
  }, []);

  const uploadFilesToProperty = useCallback(
    async (propertyId: number, coverPhotoId: number | null, files: File[]) => {
      if (files.length === 0) return;
      setUploadingPropertyId(propertyId);
      try {
        for (const file of files) await uploadPhotoToProperty(propertyId, coverPhotoId, file);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploadingPropertyId(null);
      }
    },
    [uploadPhotoToProperty]
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
            ) : visiblePropertyGroups.length === propertyGroups.length ? (
              <>
                {propertyGroups.length} album{propertyGroups.length === 1 ? "" : "s"} · {totalPhotoCount} photo
                {totalPhotoCount === 1 ? "" : "s"}
              </>
            ) : (
              <>
                {visiblePropertyGroups.length} of {propertyGroups.length} album{propertyGroups.length === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>
        {propertyGroups.length > 0 && (
          <div className={styles["topbar-actions"]}>
            <button
              type="button"
              className={styles["caption-toggle"]}
              onClick={() => setBigTiles((v) => !v)}
              aria-pressed={bigTiles}
              title={bigTiles ? "Smaller tiles" : "Larger tiles"}
            >
              {bigTiles ? "⊟ Smaller" : "⊞ Larger"}
            </button>
            <button
              type="button"
              className={`${styles["caption-toggle"]} ${showCaptions ? styles["is-active"] : ""}`}
              onClick={toggleCaptions}
              aria-pressed={showCaptions}
              title="Overlay captions on the images"
            >
              {showCaptions ? "🏷️ Captions on" : "🏷️ Captions off"}
            </button>
          </div>
        )}
      </div>

      {!activeProperty && propertyGroups.length > 0 && (
        <div className={styles["stage-filter-bar"]}>
          {STAGES.map((stage) => {
            const active = selectedStages.has(stage);
            return (
              <button
                key={stage}
                type="button"
                className={`${styles["stage-filter-chip"]} ${active ? styles["is-active"] : ""}`}
                style={{ ["--chip-color" as string]: STAGE_COLORS[stage] }}
                onClick={() => toggleStage(stage)}
                aria-pressed={active}
              >
                {stage}
              </button>
            );
          })}
          <span className={styles["stage-filter-actions"]}>
            <button type="button" className={styles["stage-filter-link"]} onClick={() => setSelectedStages(new Set(STAGES))}>
              All
            </button>
            <button type="button" className={styles["stage-filter-link"]} onClick={() => setSelectedStages(new Set())}>
              None
            </button>
          </span>
        </div>
      )}

      <div className={styles.content}>
        {propertyGroups.length === 0 ? (
          <div className={styles.empty}>
            No photos have been uploaded yet. Add photos from the Calendar or a deal&apos;s detail view.
          </div>
        ) : !activeProperty && visiblePropertyGroups.length === 0 ? (
          <div className={styles.empty}>No albums match the selected pipeline stages.</div>
        ) : !activeProperty ? (
          <div className={`${styles.grid} ${bigTiles ? styles["grid-large"] : ""}`}>
            {visiblePropertyGroups.map((property) => {
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
                {activeProperty.propertyId != null && (
                  <div className={styles["deal-group"]}>
                    <div className={styles["event-groups"]}>
                      <div
                        className={`${styles["event-group"]} ${dragOverReference ? styles["drag-over"] : ""}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverReference(true);
                        }}
                        onDragLeave={() => setDragOverReference(false)}
                        onDrop={(e) => handleDropOnReference(e)}
                      >
                        <div className={styles["event-group-header"]}>
                          <span className={styles["event-type-badge"]}>REFERENCE</span>
                          <span className={styles["event-group-name"]}>General reference</span>
                          <span className={styles["event-group-date"]}>property photos — drag a photo here to add one</span>
                          <span className={styles["event-add-actions"]}>
                            <label className={styles["event-add-btn"]}>
                              + Add
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                disabled={uploadingPropertyId === activeProperty.propertyId}
                                onChange={(e) => {
                                  const files = e.target.files ? Array.from(e.target.files) : [];
                                  e.target.value = "";
                                  if (files.length > 0) uploadFilesToProperty(activeProperty.propertyId!, activeProperty.coverPhotoId, files);
                                }}
                              />
                            </label>
                            {uploadingPropertyId === activeProperty.propertyId && (
                              <span className={styles["event-upload-status"]}>Uploading…</span>
                            )}
                          </span>
                        </div>
                        {activeProperty.referencePhotos.length > 0 ? (
                          <div className={`${styles.grid} ${bigTiles ? styles["grid-large"] : ""}`}>
                            {activeProperty.referencePhotos.map((photo) => {
                              runningIndex += 1;
                              const i = runningIndex;
                              const thumbUrl = dealThumbUrl(photo);
                              return (
                                <div
                                  key={photo.id}
                                  className={styles.thumb}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData("text/plain", String(photo.id));
                                    e.dataTransfer.effectAllowed = "move";
                                  }}
                                >
                                  <button type="button" className={styles["thumb-open"]} onClick={() => setActiveIndex(i)}>
                                    <span className={styles["thumb-image-wrap"]}>
                                      {thumbUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={thumbUrl} alt={photo.caption ?? "Reference photo"} loading="lazy" />
                                      ) : (
                                        <span className={styles["thumb-placeholder"]}>🎬</span>
                                      )}
                                      {photo.media_type === "video" && <span className={styles["video-badge"]}>▶</span>}
                                      {photo.photo_type === WALKTHROUGH_VIDEO_TYPE && <span className={styles["walkthrough-badge"]}>WALK-THRU</span>}
                                      {showCaptions && photo.caption && (
                                        <span className={styles["thumb-caption-overlay"]}>{photo.caption}</span>
                                      )}
                                    </span>
                                  </button>
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
                        ) : (
                          <div className={styles["reference-empty"]}>
                            No reference photos yet — add general property photos here.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
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
                          <div
                            key={event.id}
                            className={`${styles["event-group"]} ${
                              (event.isActionSection && dragOverDealId === deal.dealId) ||
                              (!event.isActionSection && !event.isSitePlan && dragOverEventId === event.id)
                                ? styles["drag-over"]
                                : ""
                            }`}
                            data-event-group={event.id}
                            onDragOver={
                              event.isActionSection && deal.dealId != null
                                ? (e) => {
                                    e.preventDefault();
                                    setDragOverDealId(deal.dealId);
                                  }
                                : !event.isActionSection && !event.isSitePlan && event.id > 0
                                  ? (e) => {
                                      e.preventDefault();
                                      setDragOverEventId(event.id);
                                    }
                                  : undefined
                            }
                            onDragLeave={
                              event.isActionSection
                                ? () => setDragOverDealId((d) => (d === deal.dealId ? null : d))
                                : !event.isActionSection && !event.isSitePlan && event.id > 0
                                  ? () => setDragOverEventId((cur) => (cur === event.id ? null : cur))
                                  : undefined
                            }
                            onDrop={
                              event.isActionSection
                                ? (e) => handleDropOnAction(e, deal)
                                : !event.isActionSection && !event.isSitePlan && event.id > 0
                                  ? (e) => handleDropOnEvent(e, event)
                                  : undefined
                            }
                          >
                            <div className={styles["event-group-header"]}>
                              {event.isSitePlan ? (
                                <>
                                  <span className={styles["event-type-badge"]}>SITE PLAN</span>
                                  <span className={styles["event-group-name"]}>Site Plan</span>
                                  <span className={styles["event-group-date"]}>from the estimator</span>
                                </>
                              ) : event.isActionSection ? (
                                <>
                                  <span className={styles["event-type-badge"]}>ACTION</span>
                                  <span className={styles["event-group-name"]}>Actions</span>
                                  <span className={styles["event-group-date"]}>tap ⚡ to set the next action</span>
                                </>
                              ) : (
                                <>
                                  {event.event_type && <span className={styles["event-type-badge"]}>{event.event_type}</span>}
                                  <span className={styles["event-group-name"]}>{event.name ?? "Site visit"}</span>
                                  <span className={styles["event-group-date"]}>
                                    {new Date(event.start_time).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })}
                                  </span>
                                  <Link href={`/calendar?event=${event.id}`} className={styles["event-group-link"]}>
                                    View on Calendar →
                                  </Link>
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
                                </>
                              )}
                            </div>
                            {pasteFeedback && pasteFeedback.eventId === event.id && (
                              <div className={styles["event-paste-error"]}>{pasteFeedback.message}</div>
                            )}
                            <div className={`${styles.grid} ${bigTiles ? styles["grid-large"] : ""}`}>
                              {event.photos.map((photo) => {
                                runningIndex += 1;
                                const i = runningIndex;
                                const thumbUrl = dealThumbUrl(photo);
                                return (
                                  <div
                                    key={photo.id}
                                    className={styles.thumb}
                                    draggable={deal.dealId != null && !event.isSitePlan}
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("text/plain", String(photo.id));
                                      e.dataTransfer.effectAllowed = "move";
                                    }}
                                  >
                                    <button type="button" className={styles["thumb-open"]} onClick={() => setActiveIndex(i)}>
                                      <span className={styles["thumb-image-wrap"]}>
                                        {thumbUrl ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={thumbUrl} alt={photo.caption ?? deal.dealName} loading="lazy" />
                                        ) : (
                                          <span className={styles["thumb-placeholder"]}>🎬</span>
                                        )}
                                        {photo.media_type === "video" && <span className={styles["video-badge"]}>▶</span>}
                                      {photo.photo_type === WALKTHROUGH_VIDEO_TYPE && <span className={styles["walkthrough-badge"]}>WALK-THRU</span>}
                                        {photo.is_outlier && (
                                          <span
                                            className={styles["outlier-badge"]}
                                            title="Dated differently than the rest of this event"
                                          >
                                            ⚠
                                          </span>
                                        )}
                                        {showCaptions && photo.caption && (
                                          <span className={styles["thumb-caption-overlay"]}>{photo.caption}</span>
                                        )}
                                      </span>
                                    </button>
                                    {activeProperty.propertyId != null && !event.isActionSection && (
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
                                    {event.isActionSection && deal.dealId != null ? (
                                      <button
                                        type="button"
                                        className={`${styles["thumb-next-action"]} ${photo.id === deal.nextActionPhotoId ? styles["is-next-action"] : ""}`}
                                        title={photo.id === deal.nextActionPhotoId ? "Next action — click to unset" : "Make next action"}
                                        aria-label={photo.id === deal.nextActionPhotoId ? "Next action" : "Make next action"}
                                        aria-pressed={photo.id === deal.nextActionPhotoId}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleToggleNextAction(deal, photo);
                                        }}
                                      >
                                        ⚡
                                      </button>
                                    ) : null}
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
                    {deal.dealId != null && !deal.events.some((e) => e.isActionSection && e.photos.length > 0) && (
                      <div
                        className={`${styles["event-group"]} ${styles["action-dropzone"]} ${
                          dragOverDealId === deal.dealId ? styles["drag-over"] : ""
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverDealId(deal.dealId);
                        }}
                        onDragLeave={() => setDragOverDealId((d) => (d === deal.dealId ? null : d))}
                        onDrop={(e) => handleDropOnAction(e, deal)}
                      >
                        <div className={styles["event-group-header"]}>
                          <span className={styles["event-type-badge"]}>ACTION</span>
                          <span className={styles["event-group-name"]}>Next action</span>
                          <span className={styles["event-group-date"]}>drag a photo here to add it as an action</span>
                        </div>
                        <div className={styles["reference-empty"]}>
                          Drag a photo here to add it as an action, then tap ⚡ to make it the next action.
                        </div>
                      </div>
                    )}
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
              {activePhoto.photo_type === WALKTHROUGH_VIDEO_TYPE && <span className={styles["walkthrough-badge"]}>WALK-THRU</span>}
              {activeTakeoff.length > 0 && (
                <div className={styles["lightbox-dims"]}>
                  {activeTakeoff.map((g) => {
                    const parts: string[] = [];
                    if (g.sqFt) parts.push(`${g.sqFt.toLocaleString("en-US", { maximumFractionDigits: 1 })} sq ft`);
                    if (g.linearFt) parts.push(`${g.linearFt.toLocaleString("en-US", { maximumFractionDigits: 1 })} ln ft`);
                    if (g.height) parts.push(`${g.height.toLocaleString("en-US", { maximumFractionDigits: 1 })} ft H`);
                    return (
                      <span key={g.id} className={styles["lightbox-dims-chip"]}>
                        <b>{g.label}</b>
                        {parts.length > 0 && <span>{parts.join(" · ")}</span>}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <div className={styles["lightbox-head"]}>
              <div className={styles["lightbox-head-main"]}>
                <div className={styles["lightbox-title"]}>{activeProperty.propertyLabel}</div>
                <input
                  className={styles["lightbox-caption-input"]}
                  placeholder="Add a caption…"
                  value={captionDraft}
                  disabled={savingCaptionId === activePhoto.id}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  onBlur={() => saveCaption(activePhoto, captionDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
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
                {activeProperty.propertyId != null && activePhoto.photo_type !== ACTION_PHOTO_TYPE && (
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
                {activePhotoDeal != null && activePhoto.photo_type === ACTION_PHOTO_TYPE && (
                  <button
                    type="button"
                    className={`${styles["lightbox-cover"]} ${
                      activePhoto.id === activePhotoDeal.nextActionPhotoId ? styles["is-next-action"] : ""
                    }`}
                    onClick={() => handleToggleNextAction(activePhotoDeal, activePhoto)}
                  >
                    {activePhoto.id === activePhotoDeal.nextActionPhotoId ? "⚡ Next action" : "⚡ Make next action"}
                  </button>
                )}
                {activePhoto.media_type !== "video" && (
                  <button type="button" className={styles["lightbox-annotate"]} onClick={() => setAnnotating(activePhoto)}>
                    ✏ Annotate
                  </button>
                )}
                <button type="button" className={styles["lightbox-annotate"]} onClick={() => setLinkingPhoto(activePhoto)}>
                  🔗 Link to take-off
                </button>
                {activeEstimateId && (
                  <>
                    <Link className={styles["lightbox-annotate"]} href={`/estimator/${activeEstimateId}`}>
                      📐 Open estimate
                    </Link>
                    <Link className={styles["lightbox-annotate"]} href={`/estimator/${activeEstimateId}?plan=1`}>
                      📍 View on plan
                    </Link>
                  </>
                )}
                {activePhoto.original_storage_path && (
                  <button
                    type="button"
                    className={styles["lightbox-annotate"]}
                    disabled={revertingId === activePhoto.id}
                    onClick={() => handleRevert(activePhoto)}
                  >
                    {revertingId === activePhoto.id ? "Reverting…" : "↩ Revert to original"}
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

      {annotating && (
        <PhotoAnnotator photo={annotating} onClose={() => setAnnotating(null)} onSaved={(updated) => applyPhotoUpdate(updated)} />
      )}
      {linkingPhoto && <EstimateGroupLinker photo={linkingPhoto} onClose={() => setLinkingPhoto(null)} />}
    </div>
  );
}
