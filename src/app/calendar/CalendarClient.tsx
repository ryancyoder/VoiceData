"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./calendar.module.css";
import { dealPhotoUrl, dealThumbUrl, formatPropertyLabel } from "@/lib/salesBoard";
import { EVENT_TYPES, type EventType } from "@/lib/events";
import PhotoUpload from "./PhotoUpload";
import EventMediaUpload from "./EventMediaUpload";
import EventPhotoUpload from "./EventPhotoUpload";
import ImportOutlookEvent from "./ImportOutlookEvent";

export interface GeoPhoto {
  id: number;
  deal_id: number | null;
  storage_path: string;
  caption: string | null;
  created_at: string;
  taken_at: string | null;
  latitude: number | null;
  longitude: number | null;
  event_id: number | null;
  media_type: "photo" | "video";
  poster_path: string | null;
}

export interface CalendarEvent {
  id: number;
  name: string | null;
  start: string;
  end: string;
  propertyId: number | null;
  dealId: number | null;
  eventType: EventType | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  dealIds: number[];
  photos: GeoPhoto[];
  deals: { id: number; name: string; company: string | null; jobsiteAddress: string | null }[];
}

export interface DealOption {
  id: number;
  deal_name: string;
  company: string | null;
  stage: string;
  lost_at: string | null;
}

export interface PropertyOption {
  id: number;
  address: string;
  contactLastName: string | null;
}

const HOUR_HEIGHT = 48;
const MIN_EVENT_MS = 20 * 60 * 1000;
const SNAP_MS = 15 * 60 * 1000;
const MIN_DRAG_DURATION_MS = SNAP_MS;
const MS_PER_PX = (60 * 60 * 1000) / HOUR_HEIGHT;

function snapToQuarterHour(ms: number) {
  return Math.round(ms / SNAP_MS) * SNAP_MS;
}

function startOfWeek(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}
function addDays(d: Date, n: number) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatHour(h: number) {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

interface LaidOutEvent {
  event: CalendarEvent;
  lane: number;
  totalLanes: number;
  top: number;
  height: number;
}

function layoutDay(day: Date, events: CalendarEvent[]): LaidOutEvent[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);

  const clipped = events
    .filter((e) => new Date(e.start) < dayEnd && new Date(e.end) >= dayStart)
    .map((e) => {
      const rawStart = new Date(e.start);
      const rawEnd = new Date(e.end);
      const start = rawStart < dayStart ? dayStart : rawStart;
      let end = rawEnd > dayEnd ? dayEnd : rawEnd;
      const minEnd = new Date(start.getTime() + MIN_EVENT_MS);
      if (end < minEnd) end = minEnd > dayEnd ? dayEnd : minEnd;
      return { event: e, start, end };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const laneEndTimes: number[] = [];
  const placed = clipped.map((item) => {
    const startMs = item.start.getTime();
    let lane = laneEndTimes.findIndex((endTime) => endTime <= startMs);
    if (lane === -1) {
      lane = laneEndTimes.length;
      laneEndTimes.push(item.end.getTime());
    } else {
      laneEndTimes[lane] = item.end.getTime();
    }
    return { ...item, lane };
  });
  const totalLanes = laneEndTimes.length || 1;

  return placed.map(({ event, lane, start, end }) => {
    const top = ((start.getTime() - dayStart.getTime()) / 60000 / 60) * HOUR_HEIGHT;
    const bottom = ((end.getTime() - dayStart.getTime()) / 60000 / 60) * HOUR_HEIGHT;
    return { event, lane, totalLanes, top, height: Math.max(4, bottom - top) };
  });
}

function eventLabel(event: CalendarEvent) {
  if (event.name) return event.name;
  if (event.deals.length === 0) return "Unknown deal";
  if (event.deals.length === 1) return event.deals[0].name;
  return `${event.deals[0].name} +${event.deals.length - 1}`;
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function timeRangeLabel(event: CalendarEvent) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (start.getTime() === end.getTime()) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

interface EventFormState {
  name: string;
  start: string;
  end: string;
  propertyId: number | "";
  dealId: number | "";
  eventType: EventType | "";
  notes: string;
}

function emptyEventForm(): EventFormState {
  const now = toDatetimeLocal(new Date().toISOString());
  return { name: "", start: now, end: now, propertyId: "", dealId: "", eventType: "", notes: "" };
}

function eventToForm(event: CalendarEvent): EventFormState {
  return {
    name: event.name ?? "",
    start: toDatetimeLocal(event.start),
    end: toDatetimeLocal(event.end),
    propertyId: event.propertyId ?? "",
    dealId: event.dealId ?? "",
    eventType: event.eventType ?? "",
    notes: event.notes ?? "",
  };
}

export default function CalendarClient({
  events,
  ungeotaggedCount,
  dealOptions,
  propertyOptions,
}: {
  events: CalendarEvent[];
  ungeotaggedCount: number;
  dealOptions: DealOption[];
  propertyOptions: PropertyOption[];
}) {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [newEventOpen, setNewEventOpen] = useState(false);
  const [newEventForm, setNewEventForm] = useState<EventFormState>(emptyEventForm);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [newEventError, setNewEventError] = useState<string | null>(null);

  const [editingEvent, setEditingEvent] = useState(false);
  const [editForm, setEditForm] = useState<EventFormState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [mergeTargetId, setMergeTargetId] = useState<number | "">("");
  const [merging, setMerging] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ eventId: number; startMs: number; endMs: number } | null>(null);
  const dragRef = useRef<{
    eventId: number;
    mode: "move" | "resize-start" | "resize-end";
    startClientY: number;
    originStartMs: number;
    originEndMs: number;
    currentStartMs: number;
    currentEndMs: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  function beginDrag(event: CalendarEvent, mode: "move" | "resize-start" | "resize-end", clientY: number) {
    const originStartMs = new Date(event.start).getTime();
    const originEndMs = new Date(event.end).getTime();
    dragRef.current = {
      eventId: event.id,
      mode,
      startClientY: clientY,
      originStartMs,
      originEndMs,
      currentStartMs: originStartMs,
      currentEndMs: originEndMs,
      moved: false,
    };
    setDragPreview({ eventId: event.id, startMs: originStartMs, endMs: originEndMs });
    setIsDragging(true);
  }

  async function saveEventTimes(eventId: number, startMs: number, endMs: number) {
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time: new Date(startMs).toISOString(),
          end_time: new Date(endMs).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update event time");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to update event time");
      router.refresh();
    }
  }

  useEffect(() => {
    if (!isDragging) return;

    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const deltaPx = e.clientY - d.startClientY;
      const deltaMs = snapToQuarterHour(deltaPx * MS_PER_PX);

      let currentStartMs = d.originStartMs;
      let currentEndMs = d.originEndMs;
      if (d.mode === "move") {
        currentStartMs = d.originStartMs + deltaMs;
        currentEndMs = d.originEndMs + deltaMs;
      } else if (d.mode === "resize-start") {
        currentStartMs = Math.min(d.originStartMs + deltaMs, d.originEndMs - MIN_DRAG_DURATION_MS);
      } else {
        currentEndMs = Math.max(d.originEndMs + deltaMs, d.originStartMs + MIN_DRAG_DURATION_MS);
      }

      const moved = d.moved || Math.abs(deltaPx) > 3;
      dragRef.current = { ...d, currentStartMs, currentEndMs, moved };
      setDragPreview({ eventId: d.eventId, startMs: currentStartMs, endMs: currentEndMs });
    }

    function onUp() {
      const d = dragRef.current;
      dragRef.current = null;
      setIsDragging(false);
      setDragPreview(null);
      if (d && d.moved && (d.currentStartMs !== d.originStartMs || d.currentEndMs !== d.originEndMs)) {
        suppressClickRef.current = true;
        saveEventTimes(d.eventId, d.currentStartMs, d.currentEndMs);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  async function handleCreateEvent() {
    setCreatingEvent(true);
    setNewEventError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newEventForm.name || null,
          start_time: new Date(newEventForm.start).toISOString(),
          end_time: new Date(newEventForm.end).toISOString(),
          property_id: newEventForm.propertyId === "" ? null : newEventForm.propertyId,
          deal_id: newEventForm.dealId === "" ? null : newEventForm.dealId,
          event_type: newEventForm.eventType === "" ? null : newEventForm.eventType,
          notes: newEventForm.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create event");
      setNewEventOpen(false);
      setNewEventForm(emptyEventForm());
      router.refresh();
    } catch (err) {
      setNewEventError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setCreatingEvent(false);
    }
  }

  function startEditingEvent() {
    if (!selectedEvent) return;
    setEditForm(eventToForm(selectedEvent));
    setEditError(null);
    setEditingEvent(true);
  }

  async function handleSaveEdit() {
    if (!selectedEvent || !editForm) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/events/${selectedEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name || null,
          start_time: new Date(editForm.start).toISOString(),
          end_time: new Date(editForm.end).toISOString(),
          property_id: editForm.propertyId === "" ? null : editForm.propertyId,
          deal_id: editForm.dealId === "" ? null : editForm.dealId,
          event_type: editForm.eventType === "" ? null : editForm.eventType,
          notes: editForm.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save event");
      const newDealId = data.event.deal_id as number | null;
      const hasDeal = newDealId == null || selectedEvent.dealIds.includes(newDealId);
      const dealOption = newDealId != null ? dealOptions.find((d) => d.id === newDealId) : undefined;
      setSelectedEvent({
        ...selectedEvent,
        name: data.event.name,
        start: data.event.start_time,
        end: data.event.end_time,
        propertyId: data.event.property_id,
        dealId: newDealId,
        eventType: data.event.event_type,
        latitude: data.event.latitude,
        longitude: data.event.longitude,
        notes: data.event.notes,
        dealIds: hasDeal || newDealId == null ? selectedEvent.dealIds : [...selectedEvent.dealIds, newDealId],
        deals:
          hasDeal || newDealId == null
            ? selectedEvent.deals
            : [
                ...selectedEvent.deals,
                {
                  id: newDealId,
                  name: dealOption?.deal_name ?? `Deal #${newDealId}`,
                  company: dealOption?.company ?? null,
                  jobsiteAddress: null,
                },
              ],
      });
      setEditingEvent(false);
      router.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save event");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleMerge() {
    if (!selectedEvent || mergeTargetId === "") return;
    if (!window.confirm("Merge this event into the selected one? This event will be deleted.")) return;
    setMerging(true);
    try {
      const res = await fetch(`/api/events/${selectedEvent.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEventId: mergeTargetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to merge events");
      setSelectedEvent(null);
      setMergeTargetId("");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to merge events");
    } finally {
      setMerging(false);
    }
  }

  function handleEventMediaUploaded(eventId: number, photo: GeoPhoto) {
    setSelectedEvent((current) => {
      if (!current || current.id !== eventId) return current;
      // A video uploaded straight to an event may have no deal_id at all —
      // it's attached to the event only until the event itself is linked
      // to a deal.
      if (photo.deal_id == null || current.dealIds.includes(photo.deal_id)) {
        return { ...current, photos: [...current.photos, photo] };
      }
      const dealOption = dealOptions.find((d) => d.id === photo.deal_id);
      return {
        ...current,
        photos: [...current.photos, photo],
        dealIds: [...current.dealIds, photo.deal_id],
        deals: [
          ...current.deals,
          {
            id: photo.deal_id,
            name: dealOption?.deal_name ?? `Deal #${photo.deal_id}`,
            company: dealOption?.company ?? null,
            jobsiteAddress: null,
          },
        ],
      };
    });
    router.refresh();
  }

  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 6 * HOUR_HEIGHT;
  }, []);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const eventsInWeek = useMemo(
    () => events.filter((e) => new Date(e.start) < weekEnd && new Date(e.end) >= weekStart),
    [events, weekStart, weekEnd]
  );

  const eventsForLayout = useMemo(() => {
    if (!dragPreview) return eventsInWeek;
    return eventsInWeek.map((e) =>
      e.id === dragPreview.eventId
        ? { ...e, start: new Date(dragPreview.startMs).toISOString(), end: new Date(dragPreview.endMs).toISOString() }
        : e
    );
  }, [eventsInWeek, dragPreview]);

  const today = new Date();
  const rangeLabel = `${weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const activePhoto = selectedEvent && lightboxIndex != null ? selectedEvent.photos[lightboxIndex] ?? null : null;

  useEffect(() => {
    if (lightboxIndex == null || !selectedEvent) return;
    const photoCount = selectedEvent.photos.length;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowLeft") setLightboxIndex((i) => (i != null ? Math.max(0, i - 1) : i));
      else if (e.key === "ArrowRight") setLightboxIndex((i) => (i != null ? Math.min(photoCount - 1, i + 1) : i));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, selectedEvent]);

  useEffect(() => {
    if (lightboxIndex != null || !selectedEvent) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedEvent(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, selectedEvent]);

  return (
    <div className={styles.calendar}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <h1>Calendar</h1>
          <p>
            Job site events, auto-grouped from photo timestamps &amp; location or created by hand ·{" "}
            <Link href="/photos" className={styles["brand-back"]}>
              Photos
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

      <div className={styles.toolbar}>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart((d) => addDays(d, -7))}>
          ‹ Prev
        </button>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart(startOfWeek(new Date()))}>
          Today
        </button>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart((d) => addDays(d, 7))}>
          Next ›
        </button>
        <span className={styles["range-label"]}>{rangeLabel}</span>
        <PhotoUpload propertyOptions={propertyOptions} onUploaded={() => router.refresh()} />
        <button
          type="button"
          className={styles["nav-btn"]}
          onClick={() => {
            setNewEventForm(emptyEventForm());
            setNewEventError(null);
            setNewEventOpen(true);
          }}
        >
          + New Event
        </button>
        <ImportOutlookEvent onImported={() => router.refresh()} />
        {ungeotaggedCount > 0 && (
          <span className={styles["ungeotagged-note"]}>
            {ungeotaggedCount} photo{ungeotaggedCount === 1 ? "" : "s"} without location data can&apos;t be placed here.
          </span>
        )}
      </div>

      <div className={styles["week-wrap"]}>
        <div className={styles["week-header"]}>
          <div />
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`${styles["day-header"]} ${isSameDay(day, today) ? styles["is-today"] : ""}`}
            >
              <div className={styles["day-name"]}>{day.toLocaleDateString("en-US", { weekday: "short" })}</div>
              <div className={styles["day-num"]}>{day.getDate()}</div>
            </div>
          ))}
        </div>

        {eventsInWeek.length === 0 && <div className={styles["empty-week"]}>No located photo events this week.</div>}

        <div className={styles["week-body"]} ref={bodyRef}>
          <div className={styles["time-gutter"]} style={{ height: HOUR_HEIGHT * 24 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className={styles["hour-label"]} style={{ top: h * HOUR_HEIGHT }}>
                {formatHour(h)}
              </div>
            ))}
          </div>
          {weekDays.map((day) => {
            const laidOut = layoutDay(day, eventsForLayout);
            return (
              <div
                key={day.toISOString()}
                className={styles["day-column"]}
                style={{ height: HOUR_HEIGHT * 24, ["--hour-height" as string]: `${HOUR_HEIGHT}px` }}
              >
                {laidOut.map(({ event, lane, totalLanes, top, height }) => (
                  <div
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    className={`${styles["event-block"]} ${dragPreview?.eventId === event.id ? styles["is-dragging"] : ""}`}
                    style={{
                      top,
                      height,
                      left: `${(lane / totalLanes) * 100}%`,
                      width: `${100 / totalLanes}%`,
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      beginDrag(event, "move", e.clientY);
                    }}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      setSelectedEvent(event);
                      setLightboxIndex(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedEvent(event);
                        setLightboxIndex(null);
                      }
                    }}
                  >
                    <div
                      className={styles["event-resize-handle"]}
                      style={{ top: 0 }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        beginDrag(event, "resize-start", e.clientY);
                      }}
                    />
                    {event.eventType && <div className={styles["event-type-badge"]}>{event.eventType}</div>}
                    <div className={styles["event-title"]}>{eventLabel(event)}</div>
                    <div className={styles["event-meta"]}>
                      {timeRangeLabel(event)} · {event.photos.length} photo{event.photos.length === 1 ? "" : "s"}
                    </div>
                    <div
                      className={styles["event-resize-handle"]}
                      style={{ bottom: 0 }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        beginDrag(event, "resize-end", e.clientY);
                      }}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {selectedEvent && !activePhoto && (
        <div
          className={styles["modal-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedEvent(null);
              setEditingEvent(false);
            }
          }}
        >
          <div className={styles["modal-panel"]}>
            {!editingEvent && (
              <div className={styles["modal-head"]}>
                <div>
                  {selectedEvent.eventType && (
                    <div className={styles["event-type-badge"]}>{selectedEvent.eventType}</div>
                  )}
                  <h2 className={styles["modal-title"]}>{eventLabel(selectedEvent)}</h2>
                  <div className={styles["modal-subtitle"]}>
                    {new Date(selectedEvent.start).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}{" "}
                    · {timeRangeLabel(selectedEvent)}
                  </div>
                </div>
                <div className={styles["modal-head-actions"]}>
                  <EventPhotoUpload
                    event={selectedEvent}
                    onUploaded={(photo) => handleEventMediaUploaded(selectedEvent.id, photo)}
                  />
                  <EventMediaUpload
                    event={selectedEvent}
                    onUploaded={(photo) => handleEventMediaUploaded(selectedEvent.id, photo)}
                  />
                  <button type="button" className={styles["nav-btn"]} onClick={startEditingEvent}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles["modal-close"]}
                    aria-label="Close"
                    onClick={() => {
                      setSelectedEvent(null);
                      setEditingEvent(false);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            {editingEvent && editForm && (
              <div className={styles["event-edit-form"]}>
                <label className={styles["event-edit-label"]}>
                  Name
                  <input
                    type="text"
                    placeholder={eventLabel(selectedEvent)}
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </label>
                <label className={styles["event-edit-label"]}>
                  Start
                  <input
                    type="datetime-local"
                    value={editForm.start}
                    onChange={(e) => setEditForm({ ...editForm, start: e.target.value })}
                  />
                </label>
                <label className={styles["event-edit-label"]}>
                  End
                  <input
                    type="datetime-local"
                    value={editForm.end}
                    onChange={(e) => setEditForm({ ...editForm, end: e.target.value })}
                  />
                </label>
                <label className={styles["event-edit-label"]}>
                  Property
                  <select
                    value={editForm.propertyId}
                    onChange={(e) => setEditForm({ ...editForm, propertyId: e.target.value ? Number(e.target.value) : "" })}
                  >
                    <option value="">No property</option>
                    {propertyOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatPropertyLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles["event-edit-label"]}>
                  Deal
                  <select
                    value={editForm.dealId}
                    onChange={(e) => setEditForm({ ...editForm, dealId: e.target.value ? Number(e.target.value) : "" })}
                  >
                    <option value="">No deal</option>
                    {dealOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.deal_name}
                        {d.company ? ` (${d.company})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles["event-edit-label"]}>
                  Type
                  <select
                    value={editForm.eventType}
                    onChange={(e) => setEditForm({ ...editForm, eventType: e.target.value as EventType | "" })}
                  >
                    <option value="">No type</option>
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles["event-edit-label"]}>
                  Notes
                  <textarea
                    rows={4}
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  />
                </label>
                {editError && <div className={styles["upload-error"]}>{editError}</div>}
                <div className={styles["upload-actions"]}>
                  <button type="button" className={styles["card-edit-cancel"]} onClick={() => setEditingEvent(false)} disabled={savingEdit}>
                    Cancel
                  </button>
                  <button type="button" className={styles["card-edit-save"]} onClick={handleSaveEdit} disabled={savingEdit}>
                    {savingEdit ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}

            {!editingEvent && events.length > 1 && (
              <div className={styles["merge-bar"]}>
                <select
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value ? Number(e.target.value) : "")}
                  disabled={merging}
                >
                  <option value="">Merge into…</option>
                  {events
                    .filter((e) => e.id !== selectedEvent.id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {eventLabel(e)} · {new Date(e.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </option>
                    ))}
                </select>
                <button type="button" className={styles["nav-btn"]} disabled={mergeTargetId === "" || merging} onClick={handleMerge}>
                  {merging ? "Merging…" : "Merge"}
                </button>
              </div>
            )}

            {!editingEvent && selectedEvent.notes && (
              <div className={styles["event-notes"]}>{selectedEvent.notes}</div>
            )}

            <div className={styles["deal-list"]}>
              {selectedEvent.deals.map((deal) => (
                <div key={deal.id} className={styles["deal-chip"]}>
                  <div className={styles["deal-chip-name"]}>
                    {deal.name}
                    {deal.company ? ` · ${deal.company}` : ""}
                  </div>
                  {deal.jobsiteAddress && <div className={styles["deal-chip-meta"]}>{deal.jobsiteAddress}</div>}
                  <Link href={`/photos?deal=${deal.id}`} className={styles["deal-chip-link"]}>
                    View full album →
                  </Link>
                </div>
              ))}
            </div>

            <div className={styles["photo-grid"]}>
              {selectedEvent.photos.map((photo, i) => {
                const thumbUrl = dealThumbUrl(photo);
                return (
                  <button
                    key={photo.id}
                    type="button"
                    className={styles["photo-thumb"]}
                    onClick={() => setLightboxIndex(i)}
                  >
                    {thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl} alt={photo.caption ?? eventLabel(selectedEvent)} loading="lazy" />
                    ) : (
                      <span className={styles["photo-thumb-placeholder"]}>🎬</span>
                    )}
                    {photo.media_type === "video" && <span className={styles["video-badge"]}>▶</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {selectedEvent && activePhoto && (
        <div
          className={styles["lightbox-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxIndex(null);
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
                <img src={dealPhotoUrl(activePhoto.storage_path)} alt={activePhoto.caption ?? eventLabel(selectedEvent)} />
              )}
            </div>
            <div className={styles["lightbox-foot"]}>
              <button
                type="button"
                className={styles["lightbox-nav"]}
                disabled={lightboxIndex === 0}
                onClick={() => setLightboxIndex((i) => (i != null ? Math.max(0, i - 1) : i))}
              >
                ‹ Prev
              </button>
              <button
                type="button"
                className={styles["lightbox-nav"]}
                disabled={lightboxIndex === selectedEvent.photos.length - 1}
                onClick={() =>
                  setLightboxIndex((i) => (i != null ? Math.min(selectedEvent.photos.length - 1, i + 1) : i))
                }
              >
                Next ›
              </button>
              <button type="button" className={styles["lightbox-nav"]} onClick={() => setLightboxIndex(null)}>
                Back to event
              </button>
            </div>
          </div>
        </div>
      )}

      {newEventOpen && (
        <div
          className={styles["modal-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget && !creatingEvent) setNewEventOpen(false);
          }}
        >
          <div className={styles["modal-panel"]}>
            <div className={styles["modal-head"]}>
              <h2 className={styles["modal-title"]}>New event</h2>
              <button
                type="button"
                className={styles["modal-close"]}
                aria-label="Close"
                onClick={() => setNewEventOpen(false)}
                disabled={creatingEvent}
              >
                ×
              </button>
            </div>
            <div className={styles["event-edit-form"]}>
              <label className={styles["event-edit-label"]}>
                Name (optional)
                <input
                  type="text"
                  placeholder="e.g. Site walkthrough"
                  value={newEventForm.name}
                  onChange={(e) => setNewEventForm({ ...newEventForm, name: e.target.value })}
                />
              </label>
              <label className={styles["event-edit-label"]}>
                Start
                <input
                  type="datetime-local"
                  value={newEventForm.start}
                  onChange={(e) => setNewEventForm({ ...newEventForm, start: e.target.value })}
                />
              </label>
              <label className={styles["event-edit-label"]}>
                End
                <input
                  type="datetime-local"
                  value={newEventForm.end}
                  onChange={(e) => setNewEventForm({ ...newEventForm, end: e.target.value })}
                />
              </label>
              <label className={styles["event-edit-label"]}>
                Property (optional)
                <select
                  value={newEventForm.propertyId}
                  onChange={(e) =>
                    setNewEventForm({ ...newEventForm, propertyId: e.target.value ? Number(e.target.value) : "" })
                  }
                >
                  <option value="">No property</option>
                  {propertyOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatPropertyLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles["event-edit-label"]}>
                Deal (optional)
                <select
                  value={newEventForm.dealId}
                  onChange={(e) => setNewEventForm({ ...newEventForm, dealId: e.target.value ? Number(e.target.value) : "" })}
                >
                  <option value="">No deal</option>
                  {dealOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.deal_name}
                      {d.company ? ` (${d.company})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles["event-edit-label"]}>
                Type (optional)
                <select
                  value={newEventForm.eventType}
                  onChange={(e) => setNewEventForm({ ...newEventForm, eventType: e.target.value as EventType | "" })}
                >
                  <option value="">No type</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles["event-edit-label"]}>
                Notes (optional)
                <textarea
                  rows={4}
                  value={newEventForm.notes}
                  onChange={(e) => setNewEventForm({ ...newEventForm, notes: e.target.value })}
                />
              </label>
              {newEventError && <div className={styles["upload-error"]}>{newEventError}</div>}
              <div className={styles["upload-actions"]}>
                <button
                  type="button"
                  className={styles["card-edit-cancel"]}
                  onClick={() => setNewEventOpen(false)}
                  disabled={creatingEvent}
                >
                  Cancel
                </button>
                <button type="button" className={styles["card-edit-save"]} onClick={handleCreateEvent} disabled={creatingEvent}>
                  {creatingEvent ? "Creating…" : "Create event"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
