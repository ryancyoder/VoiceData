import { supabase } from "@/lib/supabaseClient";
import { haversineMeters } from "@/lib/geocode";
import { DEFAULT_MAX_GAP_MS, DEFAULT_MAX_DISTANCE_METERS } from "@/lib/photoEvents";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";

export const EVENT_TYPES = [
  "Appointment",
  "Consultation",
  "Design",
  "Estimating",
  "Meeting",
  "Job",
  "EOM",
  "Other",
  // Certain Sales Board stage transitions auto-create a matching calendar
  // event (see PATCH /api/sales-board/[id]) — these types double as the
  // deal timeline's fixed milestones, entirely decoupled from the real
  // pipeline stages.
  "Proposal Sent",
  "Sold",
  "Project Management",
  "Invoiced",
  "Paid in Full",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// The subset of EVENT_TYPES that are auto-created by a Sales Board stage
// change rather than entered by hand — single source of truth shared by
// the deal timeline (DealTimeline.tsx), the stage-change route (PATCH
// /api/sales-board/[id]), and the Calendar (CalendarClient.tsx, which
// renders these with a distinct look since they're system-generated).
export const MILESTONE_EVENT_TYPES = ["Proposal Sent", "Sold", "Project Management", "Invoiced", "Paid in Full"] as const;

export type MilestoneEventType = (typeof MILESTONE_EVENT_TYPES)[number];

export function isMilestoneEventType(type: EventType | null | undefined): type is MilestoneEventType {
  return !!type && (MILESTONE_EVENT_TYPES as readonly string[]).includes(type);
}

export interface Event {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  property_id: number | null;
  deal_id: number | null;
  event_type: EventType | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  created_at: string;
}

interface EventPhotoPoint {
  latitude: number;
  longitude: number;
}

const HALF_HOUR_MS = 30 * 60 * 1000;

function roundDownToHalfHour(ms: number): number {
  return Math.floor(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
}

function roundUpToHalfHour(ms: number): number {
  return Math.ceil(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
}

/**
 * Rounds a photo-derived time range outward to half-hour boundaries, so the
 * calendar shows a clean block (e.g. 2:00–2:30) instead of a sliver precise
 * to the second (2:07:12–2:22:48). A single instant (or a range that still
 * lands on one boundary after rounding) gets a minimum 30-minute block
 * rather than collapsing to zero length.
 */
function roundEventRange(startMs: number, endMs: number): { startMs: number; endMs: number } {
  const roundedStart = roundDownToHalfHour(startMs);
  const roundedEnd = roundUpToHalfHour(endMs);
  return { startMs: roundedStart, endMs: roundedEnd <= roundedStart ? roundedStart + HALF_HOUR_MS : roundedEnd };
}

/** UTC calendar date an ISO timestamp falls on — the unit events are never allowed to span across. */
function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Whether a photo/video's capture time falls outside the event it's being
 * attached to directly (no clustering/matching involved, e.g. an upload
 * targeted at an already-known event). A missing takenAt is never treated
 * as an outlier — there's no date evidence to flag it by.
 */
export function isOutlierForEvent(eventStartTime: string, takenAt: string | null): boolean {
  return takenAt != null && dayKey(eventStartTime) !== dayKey(takenAt);
}

async function photoCentroid(eventId: number, extra: EventPhotoPoint[]): Promise<EventPhotoPoint | null> {
  const { data, error } = await supabase
    .from("deal_photos")
    .select("latitude, longitude")
    .eq("event_id", eventId)
    .not("latitude", "is", null)
    .not("longitude", "is", null);
  if (error) throw new Error(error.message);

  const points = [...((data ?? []) as EventPhotoPoint[]), ...extra];
  if (points.length === 0) return null;
  const latSum = points.reduce((sum, p) => sum + p.latitude, 0);
  const lonSum = points.reduce((sum, p) => sum + p.longitude, 0);
  return { latitude: latSum / points.length, longitude: lonSum / points.length };
}

/**
 * Finds an existing event whose time range is within DEFAULT_MAX_GAP_MS of
 * takenAt and whose location is within DEFAULT_MAX_DISTANCE_METERS,
 * extending it to include the new photo — otherwise creates a new event.
 * Mirrors the same time+distance clustering used by the on-the-fly
 * grouping in photoEvents.ts, but persists the result with a stable ID.
 *
 * An event never spans more than one calendar day. A photo that otherwise
 * matches (same property/deal, close enough in time+space) but lands on a
 * different day than the event's existing date still joins the cluster —
 * it's just flagged as an outlier instead of stretching the event's
 * displayed date across days it didn't actually happen on.
 */
export async function findOrCreateEvent(input: {
  latitude: number;
  longitude: number;
  takenAt: string;
  propertyId: number | null;
  dealId?: number | null;
}): Promise<{ event: Event; isOutlier: boolean }> {
  const { latitude, longitude, takenAt, propertyId, dealId = null } = input;
  const takenAtMs = new Date(takenAt).getTime();

  const { data: existing, error } = await supabase.from("events").select("*");
  if (error) throw new Error(error.message);

  let best: { event: Event; distance: number } | null = null;
  for (const event of (existing ?? []) as Event[]) {
    if (event.latitude == null || event.longitude == null) continue;
    const startMs = new Date(event.start_time).getTime();
    const endMs = new Date(event.end_time).getTime();
    const gapMs = takenAtMs < startMs ? startMs - takenAtMs : takenAtMs > endMs ? takenAtMs - endMs : 0;
    if (gapMs > DEFAULT_MAX_GAP_MS) continue;

    const distance = haversineMeters(latitude, longitude, event.latitude, event.longitude);
    if (distance > DEFAULT_MAX_DISTANCE_METERS) continue;

    if (!best || distance < best.distance) best = { event, distance };
  }

  if (best) {
    const { event } = best;
    const isOutlier = dayKey(event.start_time) !== dayKey(takenAt);
    const { startMs, endMs } = isOutlier
      ? { startMs: new Date(event.start_time).getTime(), endMs: new Date(event.end_time).getTime() }
      : roundEventRange(
          Math.min(new Date(event.start_time).getTime(), takenAtMs),
          Math.max(new Date(event.end_time).getTime(), takenAtMs)
        );
    const centroid = await photoCentroid(event.id, [{ latitude, longitude }]);

    const { data: updated, error: updateError } = await supabase
      .from("events")
      .update({
        start_time: new Date(startMs).toISOString(),
        end_time: new Date(endMs).toISOString(),
        latitude: centroid?.latitude ?? event.latitude,
        longitude: centroid?.longitude ?? event.longitude,
        property_id: event.property_id ?? propertyId,
        deal_id: event.deal_id ?? dealId,
      })
      .eq("id", event.id)
      .select()
      .single();
    if (updateError) throw new Error(updateError.message);
    return { event: updated as Event, isOutlier };
  }

  const { startMs: newStartMs, endMs: newEndMs } = roundEventRange(takenAtMs, takenAtMs);
  const { data: created, error: insertError } = await supabase
    .from("events")
    .insert({
      start_time: new Date(newStartMs).toISOString(),
      end_time: new Date(newEndMs).toISOString(),
      latitude,
      longitude,
      property_id: propertyId,
      deal_id: dealId,
    })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return { event: created as Event, isOutlier: false };
}

/**
 * Groups an event purely by deal + time proximity, for the rare case where
 * neither the photo itself nor the deal's jobsite has any known location at
 * all — there's nothing to cluster by except "close in time, same deal".
 * Same single-day-per-event rule as findOrCreateEvent: a match on a
 * different calendar day joins the cluster but is flagged as an outlier
 * rather than widening the event's date.
 */
async function findOrCreateEventForDeal(
  dealId: number,
  takenAt: string,
  propertyId: number | null
): Promise<{ event: Event; isOutlier: boolean }> {
  const takenAtMs = new Date(takenAt).getTime();

  const { data: existing, error } = await supabase.from("events").select("*").eq("deal_id", dealId);
  if (error) throw new Error(error.message);

  for (const event of (existing ?? []) as Event[]) {
    const startMs = new Date(event.start_time).getTime();
    const endMs = new Date(event.end_time).getTime();
    const gapMs = takenAtMs < startMs ? startMs - takenAtMs : takenAtMs > endMs ? takenAtMs - endMs : 0;
    if (gapMs > DEFAULT_MAX_GAP_MS) continue;

    const isOutlier = dayKey(event.start_time) !== dayKey(takenAt);
    const { startMs: newStartMs, endMs: newEndMs } = isOutlier
      ? { startMs, endMs }
      : roundEventRange(Math.min(startMs, takenAtMs), Math.max(endMs, takenAtMs));
    const { data: updated, error: updateError } = await supabase
      .from("events")
      .update({ start_time: new Date(newStartMs).toISOString(), end_time: new Date(newEndMs).toISOString() })
      .eq("id", event.id)
      .select()
      .single();
    if (updateError) throw new Error(updateError.message);
    return { event: updated as Event, isOutlier };
  }

  const { startMs: newStartMs, endMs: newEndMs } = roundEventRange(takenAtMs, takenAtMs);
  const { data: created, error: insertError } = await supabase
    .from("events")
    .insert({
      start_time: new Date(newStartMs).toISOString(),
      end_time: new Date(newEndMs).toISOString(),
      deal_id: dealId,
      property_id: propertyId,
    })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return { event: created as Event, isOutlier: false };
}

/**
 * Groups an event purely by property + time proximity, for when a property
 * is known but has no geocoded location (e.g. geocoding failed for a
 * freshly-added address) — mirrors findOrCreateEventForDeal but keyed by
 * property_id instead of deal_id, and never sets deal_id.
 */
async function findOrCreateEventForProperty(
  propertyId: number,
  takenAt: string
): Promise<{ event: Event; isOutlier: boolean }> {
  const takenAtMs = new Date(takenAt).getTime();

  const { data: existing, error } = await supabase.from("events").select("*").eq("property_id", propertyId);
  if (error) throw new Error(error.message);

  for (const event of (existing ?? []) as Event[]) {
    const startMs = new Date(event.start_time).getTime();
    const endMs = new Date(event.end_time).getTime();
    const gapMs = takenAtMs < startMs ? startMs - takenAtMs : takenAtMs > endMs ? takenAtMs - endMs : 0;
    if (gapMs > DEFAULT_MAX_GAP_MS) continue;

    const isOutlier = dayKey(event.start_time) !== dayKey(takenAt);
    const { startMs: newStartMs, endMs: newEndMs } = isOutlier
      ? { startMs, endMs }
      : roundEventRange(Math.min(startMs, takenAtMs), Math.max(endMs, takenAtMs));
    const { data: updated, error: updateError } = await supabase
      .from("events")
      .update({ start_time: new Date(newStartMs).toISOString(), end_time: new Date(newEndMs).toISOString() })
      .eq("id", event.id)
      .select()
      .single();
    if (updateError) throw new Error(updateError.message);
    return { event: updated as Event, isOutlier };
  }

  const { startMs: newStartMs, endMs: newEndMs } = roundEventRange(takenAtMs, takenAtMs);
  const { data: created, error: insertError } = await supabase
    .from("events")
    .insert({
      start_time: new Date(newStartMs).toISOString(),
      end_time: new Date(newEndMs).toISOString(),
      property_id: propertyId,
    })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return { event: created as Event, isOutlier: false };
}

/**
 * Resolves the event a photo/video belongs to when imported against a
 * property (not a deal) — the base-level attachment for imported media is a
 * property, which an event may subsequently be attached to a deal
 * independently (via the event's own edit form). Prefers the photo's own
 * GPS; falls back to the property's geocoded location when the photo has
 * none; falls back further to grouping by property + time proximity alone
 * when the property itself has no geocoded location. When no property is
 * given at all, a fresh standalone event is created (no matching is
 * possible without either a location or a property to key off of — this is
 * a defensive fallback; the normal "no location" path clusters an entire
 * upload batch into one shared event before ever calling this).
 */
export async function linkToPropertyEvent(
  propertyId: number | null,
  latitude: number | null,
  longitude: number | null,
  takenAt: string | null
): Promise<{ eventId: number; dealId: number | null; isOutlier: boolean }> {
  const effectiveTakenAt = takenAt ?? new Date().toISOString();

  let effectiveLat = latitude;
  let effectiveLng = longitude;
  if ((effectiveLat == null || effectiveLng == null) && propertyId != null) {
    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("latitude, longitude")
      .eq("id", propertyId)
      .maybeSingle();
    if (propertyError) throw new Error(propertyError.message);
    effectiveLat = property?.latitude ?? null;
    effectiveLng = property?.longitude ?? null;
  }

  let event: Event;
  let isOutlier = false;
  if (effectiveLat != null && effectiveLng != null) {
    ({ event, isOutlier } = await findOrCreateEvent({
      latitude: effectiveLat,
      longitude: effectiveLng,
      takenAt: effectiveTakenAt,
      propertyId,
      dealId: null,
    }));
  } else if (propertyId != null) {
    ({ event, isOutlier } = await findOrCreateEventForProperty(propertyId, effectiveTakenAt));
  } else {
    const { startMs, endMs } = roundEventRange(
      new Date(effectiveTakenAt).getTime(),
      new Date(effectiveTakenAt).getTime()
    );
    const { data: created, error: insertError } = await supabase
      .from("events")
      .insert({ start_time: new Date(startMs).toISOString(), end_time: new Date(endMs).toISOString() })
      .select()
      .single();
    if (insertError) throw new Error(insertError.message);
    event = created as Event;
  }

  return { eventId: event.id, dealId: event.deal_id, isOutlier };
}

/**
 * Resolves the event a photo/video belongs to — every piece of media must
 * end up attached to some event, since the event (not the deal) is the base
 * unit of truth; a deal is just what an event may subsequently be attached
 * to. Prefers the photo's own GPS; falls back to the deal's geocoded
 * jobsite location when the photo has none; falls back further to grouping
 * by deal + time proximity alone when neither is known. Unlike the old
 * version of this function, failures are no longer swallowed — an event
 * that can't be created is a real upload failure, not something to proceed
 * past silently.
 */
export async function linkToEvent(
  dealId: number,
  latitude: number | null,
  longitude: number | null,
  takenAt: string | null
): Promise<{ eventId: number; dealId: number | null; isOutlier: boolean }> {
  const effectiveTakenAt = takenAt ?? new Date().toISOString();

  const { data: deal, error: dealError } = await supabase
    .from("Sales Board")
    .select("property_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealError) throw new Error(dealError.message);
  const propertyId = deal?.property_id ?? null;

  let effectiveLat = latitude;
  let effectiveLng = longitude;
  if ((effectiveLat == null || effectiveLng == null) && propertyId != null) {
    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("latitude, longitude")
      .eq("id", propertyId)
      .maybeSingle();
    if (propertyError) throw new Error(propertyError.message);
    effectiveLat = property?.latitude ?? null;
    effectiveLng = property?.longitude ?? null;
  }

  const { event, isOutlier } =
    effectiveLat != null && effectiveLng != null
      ? await findOrCreateEvent({ latitude: effectiveLat, longitude: effectiveLng, takenAt: effectiveTakenAt, propertyId, dealId })
      : await findOrCreateEventForDeal(dealId, effectiveTakenAt, propertyId);

  return { eventId: event.id, dealId: event.deal_id, isOutlier };
}

export async function createEventManually(input: {
  name: string | null;
  start_time: string;
  end_time: string;
  property_id: number | null;
  deal_id: number | null;
  event_type: EventType | null;
  notes?: string | null;
}): Promise<Event> {
  let latitude: number | null = null;
  let longitude: number | null = null;

  if (input.property_id != null) {
    const { data: property, error } = await supabase
      .from("properties")
      .select("latitude, longitude")
      .eq("id", input.property_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    latitude = property?.latitude ?? null;
    longitude = property?.longitude ?? null;
  }

  const { data: created, error: insertError } = await supabase
    .from("events")
    .insert({
      name: input.name,
      start_time: input.start_time,
      end_time: input.end_time,
      property_id: input.property_id,
      deal_id: input.deal_id,
      event_type: input.event_type,
      notes: input.notes ?? null,
      latitude,
      longitude,
    })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return created as Event;
}

export async function updateEvent(
  id: number,
  patch: {
    name?: string | null;
    start_time?: string;
    end_time?: string;
    property_id?: number | null;
    deal_id?: number | null;
    event_type?: EventType | null;
    notes?: string | null;
  }
): Promise<Event> {
  const update: Record<string, unknown> = { ...patch };

  if (patch.property_id !== undefined && patch.property_id !== null) {
    const { data: property, error } = await supabase
      .from("properties")
      .select("latitude, longitude")
      .eq("id", patch.property_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    update.latitude = property?.latitude ?? null;
    update.longitude = property?.longitude ?? null;
  }

  const { data: updated, error: updateError } = await supabase
    .from("events")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (updateError) throw new Error(updateError.message);
  return updated as Event;
}

/**
 * Merges sourceId into targetId: every photo on the source event is
 * reassigned to the target, the target's time range and location are
 * recomputed over the combined photos, and the now-empty source event is
 * deleted.
 *
 * The merged event still never spans more than one calendar day. When
 * source and target land on the same day, their ranges combine normally.
 * When they don't, the target's own day wins — its range is left alone,
 * and any (now-reassigned) photo dated outside that day is flagged as an
 * outlier rather than stretching the merged event across days it didn't
 * happen on.
 */
export async function mergeEvents(sourceId: number, targetId: number): Promise<Event> {
  if (sourceId === targetId) throw new Error("Cannot merge an event into itself");

  const { data: rows, error: fetchError } = await supabase
    .from("events")
    .select("*")
    .in("id", [sourceId, targetId]);
  if (fetchError) throw new Error(fetchError.message);

  const source = (rows ?? []).find((e) => e.id === sourceId) as Event | undefined;
  const target = (rows ?? []).find((e) => e.id === targetId) as Event | undefined;
  if (!source || !target) throw new Error("Event not found");

  const { error: reassignError } = await supabase
    .from("deal_photos")
    .update({ event_id: targetId })
    .eq("event_id", sourceId);
  if (reassignError) throw new Error(reassignError.message);

  const targetDay = dayKey(target.start_time);
  const sameDay = dayKey(source.start_time) === targetDay;

  const startMs = sameDay
    ? Math.min(new Date(source.start_time).getTime(), new Date(target.start_time).getTime())
    : new Date(target.start_time).getTime();
  const endMs = sameDay
    ? Math.max(new Date(source.end_time).getTime(), new Date(target.end_time).getTime())
    : new Date(target.end_time).getTime();

  if (!sameDay) {
    const { data: combinedPhotos, error: combinedError } = await supabase
      .from("deal_photos")
      .select("id, taken_at")
      .eq("event_id", targetId);
    if (combinedError) throw new Error(combinedError.message);
    const outlierIds = (combinedPhotos ?? [])
      .filter((p) => p.taken_at && dayKey(p.taken_at) !== targetDay)
      .map((p) => p.id);
    if (outlierIds.length > 0) {
      const { error: flagError } = await supabase.from("deal_photos").update({ is_outlier: true }).in("id", outlierIds);
      if (flagError) throw new Error(flagError.message);
    }
  }

  const centroid = await photoCentroid(targetId, []);

  const { data: updated, error: updateError } = await supabase
    .from("events")
    .update({
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
      latitude: centroid?.latitude ?? target.latitude,
      longitude: centroid?.longitude ?? target.longitude,
      property_id: target.property_id ?? source.property_id,
      deal_id: target.deal_id ?? source.deal_id,
      event_type: target.event_type ?? source.event_type,
    })
    .eq("id", targetId)
    .select()
    .single();
  if (updateError) throw new Error(updateError.message);

  const { error: deleteError } = await supabase.from("events").delete().eq("id", sourceId);
  if (deleteError) throw new Error(deleteError.message);

  return updated as Event;
}

/**
 * Deletes an event and everything attached to it. A photo/video can never
 * exist without an event — deleting the event necessarily deletes its
 * media too, rather than leaving orphaned rows behind (deal_photos.event_id
 * has no ON DELETE behavior of its own). DB rows go first, then storage
 * objects are removed best-effort, mirroring the single-photo delete
 * route's own order of operations.
 */
export async function deleteEvent(id: number): Promise<{ deletedPhotoCount: number }> {
  const { data: photos, error: fetchError } = await supabase
    .from("deal_photos")
    .select("storage_path, poster_path")
    .eq("event_id", id);
  if (fetchError) throw new Error(fetchError.message);

  const { error: deletePhotosError } = await supabase.from("deal_photos").delete().eq("event_id", id);
  if (deletePhotosError) throw new Error(deletePhotosError.message);

  const { error: deleteEventError } = await supabase.from("events").delete().eq("id", id);
  if (deleteEventError) throw new Error(deleteEventError.message);

  const paths = (photos ?? []).flatMap((p) => (p.poster_path ? [p.storage_path, p.poster_path] : [p.storage_path]));
  if (paths.length > 0) {
    await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(paths);
  }

  return { deletedPhotoCount: photos?.length ?? 0 };
}
