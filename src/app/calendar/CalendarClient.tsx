"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./calendar.module.css";
import { dealPhotoUrl, dealThumbUrl, formatPropertyLabel, type PropertyOption } from "@/lib/salesBoard";
import { EVENT_TYPES, type EventType } from "@/lib/events";
import { usePersistentState } from "@/lib/usePersistentState";
import PhotoUpload from "./PhotoUpload";
import EventMediaUpload from "./EventMediaUpload";
import EventPhotoUpload from "./EventPhotoUpload";
import ImportOutlookEvent from "./ImportOutlookEvent";
import PhotoAnnotator from "@/components/PhotoAnnotator";
import type { DealPhoto } from "@/lib/salesBoard";
import BlockEditorModal from "./BlockEditorModal";
import { blockColor, blockHours, blockOccursOn, STAGE_COLORS, type PlanningBlock } from "@/lib/planning/blocks";
import type { Stage } from "@/lib/salesBoard";
import { computeForecast, type Assignment, type ForecastDeal, type Placement } from "@/lib/planning/schedule";

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
  is_outlier: boolean;
  original_storage_path?: string | null;
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
  // The deal's own jobsite contact, reached by way of its property — used
  // to suggest a likely-matching deal when an event's property shares the
  // same contact last name.
  contactLastName: string | null;
}

// An active deal with a production window, plotted as a multi-day all-day bar
// at the top of the calendar. startDate/endDate are 'YYYY-MM-DD' (either may be
// null — a lone date renders as a single-day bar).
export interface ProductionDeal {
  id: number;
  name: string;
  stage: Stage;
  startDate: string | null;
  endDate: string | null;
}

// Row height (bar + gap) for a stacked production bar in the all-day track.
const ALLDAY_BAR_H = 22;

// Shift a 'YYYY-MM-DD' key by n whole days (local calendar).
function shiftDateKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return localDateKey(new Date(y, m - 1, d + n));
}

interface ProductionBar {
  dealId: number;
  name: string;
  stage: Stage;
  startIdx: number; // first visible day-column index the bar covers
  endIdx: number; // last visible day-column index the bar covers
  clippedStart: boolean; // window begins before the visible week
  clippedEnd: boolean; // window ends after the visible week
  row: number; // stacking row (0-based)
}

// Lay production windows out across the visible week's day columns, packing
// non-overlapping bars onto the same row (interval partitioning). weekKeys are
// the visible days' 'YYYY-MM-DD' keys, in order (may skip weekends in work-week
// mode). A window that falls entirely in a skipped gap is dropped.
function layoutProductionBars(deals: ProductionDeal[], weekKeys: string[]): { bars: ProductionBar[]; rows: number } {
  const dayCount = weekKeys.length;
  if (dayCount === 0) return { bars: [], rows: 1 };
  const weekStartKey = weekKeys[0];
  const weekEndKey = weekKeys[dayCount - 1];

  const placed = deals
    .map((d): Omit<ProductionBar, "row"> | null => {
      const a = d.startDate || d.endDate;
      const b = d.endDate || d.startDate;
      if (!a || !b) return null;
      const start = a <= b ? a : b;
      const end = a <= b ? b : a;
      if (end < weekStartKey || start > weekEndKey) return null;
      const startIdx = weekKeys.findIndex((k) => k >= start);
      if (startIdx === -1) return null;
      let endIdx = -1;
      for (let i = dayCount - 1; i >= 0; i--) {
        if (weekKeys[i] <= end) {
          endIdx = i;
          break;
        }
      }
      if (endIdx === -1 || startIdx > endIdx) return null;
      return {
        dealId: d.id,
        name: d.name,
        stage: d.stage,
        startIdx,
        endIdx,
        clippedStart: start < weekStartKey,
        clippedEnd: end > weekEndKey,
      };
    })
    .filter((x): x is Omit<ProductionBar, "row"> => x !== null)
    .sort((x, y) => x.startIdx - y.startIdx || x.endIdx - y.endIdx);

  const rowEnds: number[] = []; // last covered index per row
  const bars: ProductionBar[] = placed.map((bar) => {
    let row = rowEnds.findIndex((end) => end < bar.startIdx);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(bar.endIdx);
    } else {
      rowEnds[row] = bar.endIdx;
    }
    return { ...bar, row };
  });
  return { bars, rows: Math.max(1, rowEnds.length) };
}

const HOUR_HEIGHT = 48;
const MIN_EVENT_MS = 20 * 60 * 1000;
const SNAP_MS = 15 * 60 * 1000;
const MIN_DRAG_DURATION_MS = SNAP_MS;

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

function layoutDay(day: Date, events: CalendarEvent[], hourPx: number): LaidOutEvent[] {
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
    const top = ((start.getTime() - dayStart.getTime()) / 60000 / 60) * hourPx;
    const bottom = ((end.getTime() - dayStart.getTime()) / 60000 / 60) * hourPx;
    return { event, lane, totalLanes, top, height: Math.max(4, bottom - top) };
  });
}

interface LaidOutBlock {
  block: PlanningBlock;
  top: number;
  height: number;
}

function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Minutes-from-midnight <-> 'HH:MM', for dragging planning blocks.
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}
function minToTime(min: number): string {
  const c = Math.max(0, Math.min(1440, Math.round(min)));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(c / 60))}:${pad(c % 60)}`;
}

// Planning blocks that fall on a given day, positioned by the same
// minutes-from-midnight → pixel mapping the events use.
function blocksForDay(day: Date, blocks: PlanningBlock[], hourPx: number): LaidOutBlock[] {
  const dateKey = localDateKey(day);
  const weekday = day.getDay();
  return blocks
    .filter((b) => blockOccursOn(b, dateKey, weekday))
    .map((b) => {
      const [sh, sm] = b.startTime.split(":").map(Number);
      const top = ((sh * 60 + sm) / 60) * hourPx;
      const height = Math.max(6, blockHours(b.startTime, b.endTime) * hourPx);
      return { block: b, top, height };
    });
}

// An explicit event name always wins. Otherwise, the property's own
// contact last name is the default — it's the one thing that's true
// regardless of whether a deal has been attached yet, unlike a deal name
// (which may not exist, or may not even name the same person if the deal
// was renamed). Deal name is only a fallback for the rare case a property
// has no contact on file at all.
function eventLabel(event: CalendarEvent, propertyOptions: PropertyOption[]) {
  if (event.name) return event.name;
  const property = event.propertyId != null ? propertyOptions.find((p) => p.id === event.propertyId) : undefined;
  if (property?.contactLastName) return property.contactLastName;
  if (event.deals.length === 1) return event.deals[0].name;
  if (event.deals.length > 1) return `${event.deals[0].name} +${event.deals.length - 1}`;
  return "Untitled event";
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

// When an Appointment event gains a deal (created, attached, or its deal
// changed), copy the event's local calendar day into the deal's
// appointment_date so the pipeline (card, column sort, timeline) reflects it.
// Best-effort: the event↔deal link itself has already been saved.
async function syncDealAppointmentDate(dealId: number, when: Date, eventType: EventType | null) {
  if (eventType !== "Appointment") return;
  try {
    await fetch(`/api/sales-board/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_date: localDateKey(when) }),
    });
  } catch {
    /* non-fatal */
  }
}

export default function CalendarClient({
  events,
  ungeotaggedCount,
  dealOptions,
  propertyOptions,
  blocks,
  forecastDeals,
  stageDefaults,
  forecastPlacements,
  productionDeals,
}: {
  events: CalendarEvent[];
  ungeotaggedCount: number;
  dealOptions: DealOption[];
  propertyOptions: PropertyOption[];
  blocks: PlanningBlock[];
  forecastDeals: ForecastDeal[];
  stageDefaults: Record<string, number>;
  forecastPlacements: Placement[];
  productionDeals: ProductionDeal[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // A deep link from elsewhere (e.g. the Sales Board deal modal's photo
  // groups) can jump straight to a specific event via ?event=<id> — land on
  // that event's week already open, with its detail modal showing.
  function findLinkedEvent(): CalendarEvent | null {
    const eventParam = searchParams.get("event");
    const eventId = eventParam ? Number(eventParam) : NaN;
    return Number.isFinite(eventId) ? events.find((e) => e.id === eventId) ?? null : null;
  }
  const [weekStart, setWeekStart] = useState(() => {
    const linked = findLinkedEvent();
    return startOfWeek(linked ? new Date(linked.start) : new Date());
  });
  // Hides Sat/Sun from the grid without changing what a "week" means for
  // navigation — Prev/Next/swipe still move by the full calendar week. Persisted
  // so the chosen view sticks across reloads.
  const [workWeek, setWorkWeek] = usePersistentState("calendar.workWeek", false);
  // 1-week (7-day) or 2-week (14-day) span. Prev/Next/swipe page by the span.
  const [twoWeek, setTwoWeek] = usePersistentState("calendar.twoWeek", false);
  const span = twoWeek ? 14 : 7;
  // Work Week also condenses the visible time range to business hours (6am–5pm);
  // otherwise the full 24-hour day is shown. Event/block tops are shifted up by
  // the grid's start hour so they line up with the condensed axis.
  const START_HOUR = workWeek ? 6 : 0;
  const END_HOUR = workWeek ? 17 : 24;
  const VISIBLE_HOURS = END_HOUR - START_HOUR;
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(() => findLinkedEvent());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [annotatingPhoto, setAnnotatingPhoto] = useState<GeoPhoto | null>(null);
  const [revertingPhotoId, setRevertingPhotoId] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // In the condensed work-week view the hours stretch to fill the grid's
  // available height (so the axis fills the screen instead of leaving blank
  // space); the full 24h view keeps a fixed hour height and scrolls. bodyH is
  // the measured height of the scroll body.
  const [bodyH, setBodyH] = useState(0);
  const hourPx = workWeek && bodyH > 0 ? Math.max(HOUR_HEIGHT, bodyH / VISIBLE_HOURS) : HOUR_HEIGHT;
  const msPerPx = (60 * 60 * 1000) / hourPx;
  const GRID_OFFSET_PX = START_HOUR * hourPx;

  // A horizontal swipe changes the week, the same as tapping Prev/Next —
  // tracked passively (no preventDefault anywhere) so it never interferes
  // with the grid's native vertical scroll or with tapping/dragging an
  // event. Only the net movement between touchstart and touchend matters;
  // it must be predominantly horizontal and past a minimum distance so an
  // ordinary vertical scroll, even one with a little sideways drift, is
  // never mistaken for a swipe.
  const SWIPE_MIN_DISTANCE = 60;
  const SWIPE_DIRECTIONAL_RATIO = 1.5;
  function handleWeekSwipeStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }
  function handleWeekSwipeEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTIONAL_RATIO) return;
    setWeekStart((d) => addDays(d, dx < 0 ? span : -span));
  }

  // After creating an event elsewhere (e.g. the Outlook importer), the
  // freshly-created row isn't in `events` yet — router.refresh() re-fetches
  // it from the server, and once it shows up here (a new `events` prop),
  // jump straight to it. Adjusting state during render like this — rather
  // than in an effect — is the pattern React itself recommends for
  // reacting to a prop change: it bails out and re-renders immediately
  // with the update, guarded by processedPendingEventId so it only fires
  // once per id.
  const [pendingOpenEventId, setPendingOpenEventId] = useState<number | null>(null);
  const [processedPendingEventId, setProcessedPendingEventId] = useState<number | null>(null);
  if (pendingOpenEventId != null && processedPendingEventId !== pendingOpenEventId) {
    const match = events.find((e) => e.id === pendingOpenEventId);
    if (match) {
      setProcessedPendingEventId(pendingOpenEventId);
      setWeekStart(startOfWeek(new Date(match.start)));
      setSelectedEvent(match);
      setPendingOpenEventId(null);
    }
  }

  const [newEventOpen, setNewEventOpen] = useState(false);
  const [newEventForm, setNewEventForm] = useState<EventFormState>(emptyEventForm);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [newEventError, setNewEventError] = useState<string | null>(null);

  // Which block the editor is open for: an existing block, or a fresh one
  // pre-dated to `date`. null = closed.
  const [blockEditor, setBlockEditor] = useState<{ block: PlanningBlock | null; date: string } | null>(null);

  // Run the same forecast the /forecast view uses, and index the resulting
  // deal placements by their block instance ("<blockId>|<date>") so each block
  // band can subtly list the deals scheduled into it.
  const [forecastTodayKey] = useState(() => localDateKey(new Date()));
  const forecastPlacementMap = useMemo(() => {
    const m = new Map<number, Placement>();
    for (const p of forecastPlacements) m.set(p.dealId, p);
    return m;
  }, [forecastPlacements]);
  const assignmentsByWindow = useMemo(() => {
    const forecast = computeForecast(blocks, forecastDeals, stageDefaults, forecastPlacementMap, {
      todayKey: forecastTodayKey,
      horizonWeeks: 26,
    });
    const map = new Map<string, Assignment[]>();
    for (const stage of forecast.stages) {
      for (const a of stage.assignments) {
        const key = `${a.blockId}|${a.date}`;
        const list = map.get(key);
        if (list) list.push(a);
        else map.set(key, [a]);
      }
    }
    return map;
  }, [blocks, forecastDeals, stageDefaults, forecastPlacementMap, forecastTodayKey]);

  const [editingEvent, setEditingEvent] = useState(false);
  const [editForm, setEditForm] = useState<EventFormState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [mergeTargetId, setMergeTargetId] = useState<number | "">("");
  const [merging, setMerging] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState(false);

  const [creatingDeal, setCreatingDeal] = useState(false);
  const [connectDealId, setConnectDealId] = useState<number | "">("");
  const [connectingDeal, setConnectingDeal] = useState(false);

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

  // Planning-block drag/resize — mirrors the event drag, but works in
  // minutes-of-day and PATCHes the block's start/end time.
  const [isBlockDragging, setIsBlockDragging] = useState(false);
  const [blockDragPreview, setBlockDragPreview] = useState<{
    blockId: string;
    startMin: number;
    endMin: number;
    originDate: string;
    targetDate: string;
  } | null>(null);
  const blockDragRef = useRef<{
    blockId: string;
    mode: "move" | "resize-start" | "resize-end";
    oneOff: boolean;
    startClientY: number;
    origStartMin: number;
    origEndMin: number;
    curStartMin: number;
    curEndMin: number;
    origDate: string;
    curDate: string;
    moved: boolean;
  } | null>(null);
  const suppressBlockClickRef = useRef(false);

  // Dragging a production bar in the all-day track (horizontal / day-based).
  const allDayTrackRef = useRef<HTMLDivElement>(null);
  const [isProdDragging, setIsProdDragging] = useState(false);
  const [prodDragPreview, setProdDragPreview] = useState<{ dealId: number; startDate: string; endDate: string } | null>(null);
  const prodDragRef = useRef<{
    dealId: number;
    mode: "move" | "resize-start" | "resize-end";
    startClientX: number;
    dayWidthPx: number;
    origStart: string;
    origEnd: string;
    curStart: string;
    curEnd: string;
    moved: boolean;
  } | null>(null);
  const suppressProdClickRef = useRef(false);

  function beginProdDrag(bar: ProductionBar, mode: "move" | "resize-start" | "resize-end", clientX: number, dayCount: number) {
    const deal = productionDeals.find((d) => d.id === bar.dealId);
    if (!deal) return;
    const origStart = (deal.startDate || deal.endDate) as string;
    const origEnd = (deal.endDate || deal.startDate) as string;
    const trackW = allDayTrackRef.current?.clientWidth ?? 0;
    const dayWidthPx = trackW > 0 ? trackW / Math.max(1, dayCount) : 40;
    prodDragRef.current = {
      dealId: bar.dealId,
      mode,
      startClientX: clientX,
      dayWidthPx,
      origStart,
      origEnd,
      curStart: origStart,
      curEnd: origEnd,
      moved: false,
    };
    setProdDragPreview({ dealId: bar.dealId, startDate: origStart, endDate: origEnd });
    setIsProdDragging(true);
  }

  async function saveProdDrag(dealId: number, startDate: string, endDate: string) {
    try {
      const res = await fetch(`/api/sales-board/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: startDate, end_date: endDate }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Failed to reschedule production");
      }
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to reschedule production");
      router.refresh();
    }
  }

  useEffect(() => {
    if (!isProdDragging) return;
    function onMove(e: PointerEvent) {
      const d = prodDragRef.current;
      if (!d) return;
      const deltaDays = Math.round((e.clientX - d.startClientX) / d.dayWidthPx);
      let s = d.origStart;
      let en = d.origEnd;
      if (d.mode === "move") {
        s = shiftDateKey(d.origStart, deltaDays);
        en = shiftDateKey(d.origEnd, deltaDays);
      } else if (d.mode === "resize-start") {
        s = shiftDateKey(d.origStart, deltaDays);
        if (s > en) s = en; // don't cross the end
      } else {
        en = shiftDateKey(d.origEnd, deltaDays);
        if (en < s) en = s; // don't cross the start
      }
      const moved = d.moved || Math.abs(e.clientX - d.startClientX) > 3;
      prodDragRef.current = { ...d, curStart: s, curEnd: en, moved };
      setProdDragPreview({ dealId: d.dealId, startDate: s, endDate: en });
    }
    function onUp() {
      const d = prodDragRef.current;
      prodDragRef.current = null;
      setIsProdDragging(false);
      setProdDragPreview(null);
      if (d && d.moved && (d.curStart !== d.origStart || d.curEnd !== d.origEnd)) {
        suppressProdClickRef.current = true;
        saveProdDrag(d.dealId, d.curStart, d.curEnd);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProdDragging]);

  function beginBlockDrag(block: PlanningBlock, mode: "move" | "resize-start" | "resize-end", clientY: number, originDate: string) {
    const origStartMin = timeToMin(block.startTime);
    const origEndMin = timeToMin(block.endTime);
    blockDragRef.current = {
      blockId: block.id,
      mode,
      oneOff: block.kind === "one_off",
      startClientY: clientY,
      origStartMin,
      origEndMin,
      curStartMin: origStartMin,
      curEndMin: origEndMin,
      origDate: originDate,
      curDate: originDate,
      moved: false,
    };
    setBlockDragPreview({ blockId: block.id, startMin: origStartMin, endMin: origEndMin, originDate, targetDate: originDate });
    setIsBlockDragging(true);
  }

  async function saveBlockDrag(blockId: string, startMin: number, endMin: number, blockDate?: string) {
    try {
      const body: Record<string, unknown> = { startTime: minToTime(startMin), endTime: minToTime(endMin) };
      if (blockDate) body.blockDate = blockDate;
      const res = await fetch(`/api/planning/blocks/${blockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Failed to update block");
      }
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to update block");
      router.refresh();
    }
  }

  // Dragging one occurrence of a recurring block detaches it into a standalone
  // one-off at the new date/time; the rest of the series is unchanged.
  async function detachBlock(blockId: string, originDate: string, targetDate: string, startMin: number, endMin: number) {
    try {
      const res = await fetch(`/api/planning/blocks/${blockId}/detach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: originDate, blockDate: targetDate, startTime: minToTime(startMin), endTime: minToTime(endMin) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || "Failed to move block");
      }
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to move block");
      router.refresh();
    }
  }

  useEffect(() => {
    if (!isBlockDragging) return;
    const SNAP = 15;
    const pxPerMin = hourPx / 60;

    function onMove(e: PointerEvent) {
      const d = blockDragRef.current;
      if (!d) return;
      const deltaPx = e.clientY - d.startClientY;
      const deltaMin = Math.round(deltaPx / pxPerMin / SNAP) * SNAP;
      const dur = d.origEndMin - d.origStartMin;
      let s = d.origStartMin;
      let en = d.origEndMin;
      if (d.mode === "move") {
        s = Math.max(0, Math.min(1440 - dur, d.origStartMin + deltaMin));
        en = s + dur;
      } else if (d.mode === "resize-start") {
        s = Math.max(0, Math.min(d.origStartMin + deltaMin, d.origEndMin - SNAP));
      } else {
        en = Math.min(1440, Math.max(d.origEndMin + deltaMin, d.origStartMin + SNAP));
      }
      // Horizontal (cross-day) move. The dragging band has pointer-events:none,
      // so elementFromPoint sees the day column beneath it.
      let targetDate = d.curDate;
      if (d.mode === "move") {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const dateEl = el?.closest("[data-date]");
        const dd = dateEl?.getAttribute("data-date");
        if (dd) targetDate = dd;
      }
      const moved = d.moved || Math.abs(deltaPx) > 3 || targetDate !== d.origDate;
      blockDragRef.current = { ...d, curStartMin: s, curEndMin: en, curDate: targetDate, moved };
      setBlockDragPreview({ blockId: d.blockId, startMin: s, endMin: en, originDate: d.origDate, targetDate });
    }

    function onUp() {
      const d = blockDragRef.current;
      blockDragRef.current = null;
      setIsBlockDragging(false);
      setBlockDragPreview(null);
      const timesChanged = d && (d.curStartMin !== d.origStartMin || d.curEndMin !== d.origEndMin);
      const dayChanged = d && d.curDate !== d.origDate;
      if (d && d.moved && (timesChanged || dayChanged)) {
        suppressBlockClickRef.current = true;
        if (d.oneOff) {
          saveBlockDrag(d.blockId, d.curStartMin, d.curEndMin, dayChanged ? d.curDate : undefined);
        } else {
          // A recurring occurrence detaches into a one-off at the new day/time.
          detachBlock(d.blockId, d.origDate, d.curDate, d.curStartMin, d.curEndMin);
        }
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBlockDragging]);

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
      const deltaMs = snapToQuarterHour(deltaPx * msPerPx);

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
      if (newEventForm.dealId !== "") {
        await syncDealAppointmentDate(
          newEventForm.dealId,
          new Date(newEventForm.start),
          newEventForm.eventType === "" ? null : newEventForm.eventType
        );
      }
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
      // Newly attaching a deal to this appointment sets that deal's appointment date.
      if (newDealId != null && newDealId !== selectedEvent.dealId) {
        await syncDealAppointmentDate(
          newDealId,
          new Date(editForm.start),
          editForm.eventType === "" ? null : editForm.eventType
        );
      }
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

  // Creates a brand-new deal (stage: Propose) from an event that doesn't
  // have one yet, pointing it at that event's own property (if any) — the
  // deal shares the property's existing contact rather than duplicating
  // it — then attaches the event to it, the same relationship the Edit
  // form's Deal dropdown sets by hand.
  async function handleCreateDealFromEvent() {
    if (!selectedEvent) return;
    setCreatingDeal(true);
    try {
      const property =
        selectedEvent.propertyId != null ? propertyOptions.find((p) => p.id === selectedEvent.propertyId) : undefined;
      // Named by last name only, per how deals are meant to read at a
      // glance — prefer the property's actual contact; when there's no
      // property/contact yet, fall back to the last word of the event's own
      // name as a best-effort last name.
      const lastNameFromEventName = selectedEvent.name?.trim().split(/\s+/).pop();
      const dealName = property?.contactLastName || lastNameFromEventName || property?.address || "New Deal";

      const dealRes = await fetch("/api/sales-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_name: dealName,
          stage: "Propose",
          property_id: property?.id ?? null,
        }),
      });
      const dealData = await dealRes.json();
      if (!dealRes.ok) throw new Error(dealData.error || "Failed to create deal");
      const newDeal = dealData.deal;

      const eventRes = await fetch(`/api/events/${selectedEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: newDeal.id }),
      });
      const eventData = await eventRes.json();
      if (!eventRes.ok) throw new Error(eventData.error || "Failed to attach the new deal to this event");

      await syncDealAppointmentDate(newDeal.id, new Date(selectedEvent.start), selectedEvent.eventType);

      setSelectedEvent({
        ...selectedEvent,
        dealId: newDeal.id,
        dealIds: [...selectedEvent.dealIds, newDeal.id],
        deals: [
          ...selectedEvent.deals,
          {
            id: newDeal.id,
            name: newDeal.deal_name,
            company: newDeal.company ?? null,
            jobsiteAddress: property?.address ?? null,
          },
        ],
      });
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create deal");
    } finally {
      setCreatingDeal(false);
    }
  }

  // Attaches an already-existing deal to the event, mirroring what the
  // Edit form's Deal dropdown does, but surfaced directly alongside
  // "+ Create New Deal" so connecting to an existing deal doesn't require
  // opening the edit form and hunting through every deal in the list.
  async function handleConnectExistingDeal(dealId: number) {
    if (!selectedEvent) return;
    setConnectingDeal(true);
    try {
      const eventRes = await fetch(`/api/events/${selectedEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });
      const eventData = await eventRes.json();
      if (!eventRes.ok) throw new Error(eventData.error || "Failed to connect this deal to the event");

      await syncDealAppointmentDate(dealId, new Date(selectedEvent.start), selectedEvent.eventType);

      const dealOption = dealOptions.find((d) => d.id === dealId);
      setSelectedEvent({
        ...selectedEvent,
        dealId,
        dealIds: [...selectedEvent.dealIds, dealId],
        deals: [
          ...selectedEvent.deals,
          {
            id: dealId,
            name: dealOption?.deal_name ?? `Deal #${dealId}`,
            company: dealOption?.company ?? null,
            jobsiteAddress: null,
          },
        ],
      });
      setConnectDealId("");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to connect deal");
    } finally {
      setConnectingDeal(false);
    }
  }

  // Suggests deals whose own jobsite contact shares a last name with this
  // event's property — the same person is very likely already in the
  // pipeline under an existing deal rather than needing a brand-new one.
  const matchingDeals = useMemo(() => {
    if (!selectedEvent) return [];
    const property =
      selectedEvent.propertyId != null ? propertyOptions.find((p) => p.id === selectedEvent.propertyId) : undefined;
    const lastName = property?.contactLastName?.trim().toLowerCase();
    if (!lastName) return [];
    return dealOptions.filter(
      (d) => d.contactLastName?.trim().toLowerCase() === lastName && !selectedEvent.dealIds.includes(d.id)
    );
  }, [selectedEvent, propertyOptions, dealOptions]);

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

  async function handleDeleteEvent() {
    if (!selectedEvent) return;
    const photoWarning =
      selectedEvent.photos.length > 0
        ? ` Its ${selectedEvent.photos.length} attached photo${selectedEvent.photos.length === 1 ? "" : "s"} will be deleted too.`
        : "";
    if (!window.confirm(`Delete this event?${photoWarning} This can't be undone.`)) return;
    setDeletingEvent(true);
    try {
      const res = await fetch(`/api/events/${selectedEvent.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete event");
      setSelectedEvent(null);
      setEditingEvent(false);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete event");
    } finally {
      setDeletingEvent(false);
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
    // Condensed work-week grid already starts at 6am, so no scroll offset needed.
    if (bodyRef.current) bodyRef.current.scrollTop = workWeek ? 0 : 6 * HOUR_HEIGHT;
  }, [workWeek]);

  // Track the scroll body's height so the condensed work-week grid can stretch
  // its hours to fill it.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const weekDays = useMemo(() => {
    const days = Array.from({ length: span }, (_, i) => addDays(weekStart, i));
    return workWeek ? days.filter((d) => d.getDay() !== 0 && d.getDay() !== 6) : days;
  }, [weekStart, workWeek, span]);
  const weekEnd = useMemo(() => addDays(weekStart, span), [weekStart, span]);

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

  // Production windows plotted as multi-day bars in the all-day track. While a
  // bar is being dragged, the grabbed deal's dates are swapped for the live
  // preview so the bar follows the cursor. (Left un-memoized — the React
  // Compiler handles memoization; a manual chain here can't be preserved.)
  const prodDealsForLayout = prodDragPreview
    ? productionDeals.map((d) =>
        d.id === prodDragPreview.dealId ? { ...d, startDate: prodDragPreview.startDate, endDate: prodDragPreview.endDate } : d
      )
    : productionDeals;
  const productionBars = layoutProductionBars(
    prodDealsForLayout,
    weekDays.map((d) => localDateKey(d))
  );

  const today = new Date();
  const rangeLabel = `${weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekDays[weekDays.length - 1].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const activePhoto = selectedEvent && lightboxIndex != null ? selectedEvent.photos[lightboxIndex] ?? null : null;

  // Fold a server-returned deal_photos row (after annotate/revert) back into the
  // open event's photo list in place, so the lightbox re-points at the new file.
  function applyPhotoUpdate(updated: DealPhoto) {
    setSelectedEvent((cur) =>
      cur
        ? {
            ...cur,
            photos: cur.photos.map((p) =>
              p.id === updated.id
                ? { ...p, storage_path: updated.storage_path, original_storage_path: updated.original_storage_path ?? null, caption: updated.caption }
                : p
            ),
          }
        : cur
    );
  }

  async function handleRevertPhoto(photo: GeoPhoto) {
    if (!confirm("Revert to the original photo? The annotated version will be discarded.")) return;
    setRevertingPhotoId(photo.id);
    try {
      const res = await fetch(`/api/photos/${photo.id}/annotate`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revert photo");
      applyPhotoUpdate(data.photo as DealPhoto);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revert photo");
    } finally {
      setRevertingPhotoId(null);
    }
  }

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
          <p>Job site events, auto-grouped from photo timestamps &amp; location or created by hand</p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart((d) => addDays(d, -span))}>
          ‹ Prev
        </button>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart(startOfWeek(new Date()))}>
          Today
        </button>
        <button type="button" className={styles["nav-btn"]} onClick={() => setWeekStart((d) => addDays(d, span))}>
          Next ›
        </button>
        <button
          type="button"
          className={`${styles["nav-btn"]} ${workWeek ? styles["is-active"] : ""}`}
          onClick={() => setWorkWeek((w) => !w)}
          aria-pressed={workWeek}
        >
          Work Week
        </button>
        <button
          type="button"
          className={`${styles["nav-btn"]} ${twoWeek ? styles["is-active"] : ""}`}
          onClick={() => setTwoWeek((v) => !v)}
          aria-pressed={twoWeek}
          title="Toggle 1-week / 2-week view"
        >
          2 Weeks
        </button>
        <span className={styles["range-label"]}>{rangeLabel}</span>
        <PhotoUpload
          propertyOptions={propertyOptions}
          onUploaded={(date) => {
            if (date) setWeekStart(startOfWeek(date));
            router.refresh();
          }}
        />
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
        <button
          type="button"
          className={styles["nav-btn"]}
          onClick={() => setBlockEditor({ block: null, date: localDateKey(new Date()) })}
        >
          + New Block
        </button>
        <ImportOutlookEvent
          onImported={(eventId) => {
            setPendingOpenEventId(eventId);
            router.refresh();
          }}
        />
        {ungeotaggedCount > 0 && (
          <span className={styles["ungeotagged-note"]}>
            {ungeotaggedCount} photo{ungeotaggedCount === 1 ? "" : "s"} without location data can&apos;t be placed here.
          </span>
        )}
      </div>

      <div
        className={styles["week-wrap"]}
        style={{ ["--day-count" as string]: weekDays.length }}
        onTouchStart={handleWeekSwipeStart}
        onTouchEnd={handleWeekSwipeEnd}
      >
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

        <div className={styles["allday-row"]}>
          <div className={styles["allday-gutter"]}>Production</div>
          <div ref={allDayTrackRef} className={styles["allday-track"]} style={{ height: productionBars.rows * ALLDAY_BAR_H + 6 }}>
            {productionBars.bars.map((bar) => {
              const span = bar.endIdx - bar.startIdx + 1;
              const color = STAGE_COLORS[bar.stage] ?? STAGE_COLORS["Project Management"];
              const dragging = prodDragPreview?.dealId === bar.dealId;
              return (
                <div
                  key={bar.dealId}
                  className={`${styles["allday-bar"]} ${dragging ? styles["allday-bar-dragging"] : ""} ${
                    bar.clippedStart ? styles["clip-start"] : ""
                  } ${bar.clippedEnd ? styles["clip-end"] : ""}`}
                  style={{
                    left: `calc(${bar.startIdx} * (100% / ${weekDays.length}) + 1px)`,
                    width: `calc(${span} * (100% / ${weekDays.length}) - 2px)`,
                    top: bar.row * ALLDAY_BAR_H + 2,
                    ["--bar-color" as string]: color,
                  }}
                  title={`${bar.name} · production (drag to reschedule)`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    beginProdDrag(bar, "move", e.clientX, weekDays.length);
                  }}
                  onClick={() => {
                    if (suppressProdClickRef.current) {
                      suppressProdClickRef.current = false;
                      return;
                    }
                    router.push(`/sales-board?deal=${bar.dealId}`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/sales-board?deal=${bar.dealId}`);
                    }
                  }}
                >
                  {!bar.clippedStart && (
                    <span
                      className={styles["allday-resize-start"]}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        beginProdDrag(bar, "resize-start", e.clientX, weekDays.length);
                      }}
                    />
                  )}
                  <span className={styles["allday-bar-label"]}>{bar.name}</span>
                  {!bar.clippedEnd && (
                    <span
                      className={styles["allday-resize-end"]}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        beginProdDrag(bar, "resize-end", e.clientX, weekDays.length);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {eventsInWeek.length === 0 && <div className={styles["empty-week"]}>No located photo events this week.</div>}

        <div className={styles["week-body"]} ref={bodyRef}>
          <div className={styles["time-gutter"]} style={{ height: hourPx * VISIBLE_HOURS }}>
            {Array.from({ length: VISIBLE_HOURS }, (_, i) => START_HOUR + i).map((h) => (
              <div key={h} className={styles["hour-label"]} style={{ top: (h - START_HOUR) * hourPx }}>
                {formatHour(h)}
              </div>
            ))}
          </div>
          {weekDays.map((day) => {
            const laidOut = layoutDay(day, eventsForLayout, hourPx);
            const dayKey = localDateKey(day);
            // While dragging, move the grabbed occurrence out of its origin day
            // into the target day. For a recurring block only that one occurrence
            // moves; the rest of the series stays in place.
            const dayBlocks = (() => {
              const base = blocksForDay(day, blocks, hourPx);
              if (!blockDragPreview) return base;
              const dragged = blocks.find((b) => b.id === blockDragPreview.blockId);
              if (!dragged) return base;
              const list =
                dayKey === blockDragPreview.originDate
                  ? base.filter((db) => db.block.id !== blockDragPreview.blockId)
                  : base;
              if (blockDragPreview.targetDate === dayKey && !list.some((db) => db.block.id === blockDragPreview.blockId)) {
                return [...list, { block: dragged, top: 0, height: 0 }];
              }
              return list;
            })();
            return (
              <div
                key={day.toISOString()}
                data-date={dayKey}
                className={styles["day-column"]}
                style={{ height: hourPx * VISIBLE_HOURS, ["--hour-height" as string]: `${hourPx}px` }}
              >
                {dayBlocks.map(({ block, top, height }) => {
                  const color = blockColor(block);
                  const open = () => setBlockEditor({ block, date: block.blockDate ?? localDateKey(day) });
                  const bandDeals = assignmentsByWindow.get(`${block.id}|${dayKey}`) ?? [];
                  const bp = blockDragPreview?.blockId === block.id ? blockDragPreview : null;
                  const bTop = (bp ? (bp.startMin / 60) * hourPx : top) - GRID_OFFSET_PX;
                  const bHeight = bp ? Math.max(6, ((bp.endMin - bp.startMin) / 60) * hourPx) : height;
                  return (
                    <div
                      key={block.id}
                      role="button"
                      tabIndex={0}
                      className={`${styles["planning-block"]} ${bp ? styles["planning-block-dragging"] : ""}`}
                      style={{
                        top: bTop,
                        height: bHeight,
                        background: `color-mix(in srgb, ${color} 13%, transparent)`,
                        borderLeft: `3px solid color-mix(in srgb, ${color} 55%, transparent)`,
                      }}
                      title={`Planning block · ${block.stage} — drag to move, edges to resize`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        beginBlockDrag(block, "move", e.clientY, dayKey);
                      }}
                      onClick={() => {
                        if (suppressBlockClickRef.current) {
                          suppressBlockClickRef.current = false;
                          return;
                        }
                        open();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          open();
                        }
                      }}
                    >
                      <div
                        className={styles["event-resize-handle"]}
                        style={{ top: 0 }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          beginBlockDrag(block, "resize-start", e.clientY, dayKey);
                        }}
                      />
                      <span
                        className={styles["planning-block-label"]}
                        style={{ color: `color-mix(in srgb, ${color} 70%, var(--text-muted, #64748b))` }}
                      >
                        {block.title ?? block.stage}
                      </span>
                      {bandDeals.length > 0 && (
                        <div className={styles["planning-block-deals"]}>
                          {bandDeals.slice(0, 5).map((a) => (
                            <span
                              key={a.dealId}
                              className={styles["planning-block-deal"]}
                              title={`${a.dealName} · ${a.hours}h`}
                            >
                              {a.dealName}
                            </span>
                          ))}
                          {bandDeals.length > 5 && (
                            <span className={styles["planning-block-deal"]}>+{bandDeals.length - 5} more</span>
                          )}
                        </div>
                      )}
                      <div
                        className={styles["event-resize-handle"]}
                        style={{ bottom: 0 }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          beginBlockDrag(block, "resize-end", e.clientY, dayKey);
                        }}
                      />
                    </div>
                  );
                })}
                {laidOut.map(({ event, lane, totalLanes, top, height }) => (
                  <div
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    className={`${styles["event-block"]} ${
                      event.latitude == null || event.longitude == null
                        ? styles["no-location"]
                        : event.deals.length === 0
                          ? styles["no-deal"]
                          : ""
                    } ${dragPreview?.eventId === event.id ? styles["is-dragging"] : ""}`}
                    style={{
                      top: top - GRID_OFFSET_PX,
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
                    {event.photos.length > 0 && (
                      <div
                        className={styles["event-photo-badge"]}
                        title={`${event.photos.length} photo${event.photos.length === 1 ? "" : "s"}`}
                      >
                        📷
                      </div>
                    )}
                    {event.eventType && <div className={styles["event-type-badge"]}>{event.eventType}</div>}
                    <div className={styles["event-title"]}>{eventLabel(event, propertyOptions)}</div>
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
                  <h2 className={styles["modal-title"]}>{eventLabel(selectedEvent, propertyOptions)}</h2>
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
                    className={styles["delete-btn"]}
                    onClick={handleDeleteEvent}
                    disabled={deletingEvent}
                  >
                    {deletingEvent ? "Deleting…" : "Delete"}
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
                    placeholder={eventLabel(selectedEvent, propertyOptions)}
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
                        {eventLabel(e, propertyOptions)} · {new Date(e.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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

            {!editingEvent && selectedEvent.deals.length === 0 && (
              <div className={styles["bulk-match-bar"]}>
                {matchingDeals.length > 0 ? (
                  <span>
                    This property&apos;s contact matches{" "}
                    {matchingDeals.length === 1 ? "an existing deal" : `${matchingDeals.length} existing deals`}:{" "}
                    <strong>{matchingDeals.map((d) => d.deal_name).join(", ")}</strong>
                  </span>
                ) : (
                  <span>No deal attached yet</span>
                )}
                <div className={styles["bulk-match-actions"]}>
                  {matchingDeals.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={styles["bulk-match-btn"]}
                      disabled={connectingDeal}
                      onClick={() => handleConnectExistingDeal(d.id)}
                    >
                      Connect to {d.deal_name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles["bulk-match-btn"]}
                    onClick={handleCreateDealFromEvent}
                    disabled={creatingDeal}
                  >
                    {creatingDeal ? "Creating…" : "+ Create New Deal"}
                  </button>
                  <select
                    className={styles["upload-select"]}
                    value={connectDealId}
                    disabled={connectingDeal}
                    onChange={(e) => setConnectDealId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">Choose a deal…</option>
                    {dealOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.deal_name}
                        {d.company ? ` (${d.company})` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles["bulk-match-btn"]}
                    disabled={connectingDeal || connectDealId === ""}
                    onClick={() => handleConnectExistingDeal(connectDealId as number)}
                  >
                    {connectingDeal ? "Connecting…" : "Connect"}
                  </button>
                </div>
              </div>
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
                      <img src={thumbUrl} alt={photo.caption ?? eventLabel(selectedEvent, propertyOptions)} loading="lazy" />
                    ) : (
                      <span className={styles["photo-thumb-placeholder"]}>🎬</span>
                    )}
                    {photo.media_type === "video" && <span className={styles["video-badge"]}>▶</span>}
                    {photo.is_outlier && (
                      <span className={styles["outlier-badge"]} title="Dated differently than the rest of this event">
                        ⚠
                      </span>
                    )}
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
                <img src={dealPhotoUrl(activePhoto.storage_path)} alt={activePhoto.caption ?? eventLabel(selectedEvent, propertyOptions)} />
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
              {activePhoto.media_type !== "video" && (
                <button type="button" className={styles["lightbox-nav"]} onClick={() => setAnnotatingPhoto(activePhoto)}>
                  ✏ Annotate
                </button>
              )}
              {activePhoto.original_storage_path && (
                <button
                  type="button"
                  className={styles["lightbox-nav"]}
                  disabled={revertingPhotoId === activePhoto.id}
                  onClick={() => handleRevertPhoto(activePhoto)}
                >
                  {revertingPhotoId === activePhoto.id ? "Reverting…" : "↩ Revert to original"}
                </button>
              )}
              <button type="button" className={styles["lightbox-nav"]} onClick={() => setLightboxIndex(null)}>
                Back to event
              </button>
            </div>
          </div>
        </div>
      )}

      {annotatingPhoto && (
        <PhotoAnnotator
          photo={annotatingPhoto}
          onClose={() => setAnnotatingPhoto(null)}
          onSaved={(updated) => applyPhotoUpdate(updated)}
        />
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

      {blockEditor && (
        <BlockEditorModal
          block={blockEditor.block}
          defaultDate={blockEditor.date}
          onClose={() => setBlockEditor(null)}
          onSaved={() => {
            setBlockEditor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
