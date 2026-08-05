import { supabase } from "@/lib/supabaseClient";
import { haversineMeters } from "@/lib/geocode";
import { DEFAULT_MAX_GAP_MS, DEFAULT_MAX_DISTANCE_METERS } from "@/lib/photoEvents";

export const EVENT_TYPES = ["Appointment", "Consultation", "Design", "Estimating", "Meeting", "Job", "Other"] as const;

export type EventType = (typeof EVENT_TYPES)[number];

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
  created_at: string;
}

interface EventPhotoPoint {
  latitude: number;
  longitude: number;
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
 */
export async function findOrCreateEvent(input: {
  latitude: number;
  longitude: number;
  takenAt: string;
  propertyId: number | null;
  dealId?: number | null;
}): Promise<Event> {
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
    const startMs = Math.min(new Date(event.start_time).getTime(), takenAtMs);
    const endMs = Math.max(new Date(event.end_time).getTime(), takenAtMs);
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
    return updated as Event;
  }

  const { data: created, error: insertError } = await supabase
    .from("events")
    .insert({
      start_time: takenAt,
      end_time: takenAt,
      latitude,
      longitude,
      property_id: propertyId,
      deal_id: dealId,
    })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return created as Event;
}

/**
 * Groups an event purely by deal + time proximity, for the rare case where
 * neither the photo itself nor the deal's jobsite has any known location at
 * all — there's nothing to cluster by except "close in time, same deal".
 */
async function findOrCreateEventForDeal(dealId: number, takenAt: string, propertyId: number | null): Promise<Event> {
  const takenAtMs = new Date(takenAt).getTime();

  const { data: existing, error } = await supabase.from("events").select("*").eq("deal_id", dealId);
  if (error) throw new Error(error.message);

  for (const event of (existing ?? []) as Event[]) {
    const startMs = new Date(event.start_time).getTime();
    const endMs = new Date(event.end_time).getTime();
    const gapMs = takenAtMs < startMs ? startMs - takenAtMs : takenAtMs > endMs ? takenAtMs - endMs : 0;
    if (gapMs > DEFAULT_MAX_GAP_MS) continue;

    const newStartMs = Math.min(startMs, takenAtMs);
    const newEndMs = Math.max(endMs, takenAtMs);
    const { data: updated, error: updateError } = await supabase
      .from("events")
      .update({ start_time: new Date(newStartMs).toISOString(), end_time: new Date(newEndMs).toISOString() })
      .eq("id", event.id)
      .select()
      .single();
    if (updateError) throw new Error(updateError.message);
    return updated as Event;
  }

  const { data: created, error: insertError } = await supabase
    .from("events")
    .insert({ start_time: takenAt, end_time: takenAt, deal_id: dealId, property_id: propertyId })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return created as Event;
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
): Promise<{ eventId: number; dealId: number | null }> {
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

  const event =
    effectiveLat != null && effectiveLng != null
      ? await findOrCreateEvent({ latitude: effectiveLat, longitude: effectiveLng, takenAt: effectiveTakenAt, propertyId, dealId })
      : await findOrCreateEventForDeal(dealId, effectiveTakenAt, propertyId);

  return { eventId: event.id, dealId: event.deal_id };
}

export async function createEventManually(input: {
  name: string | null;
  start_time: string;
  end_time: string;
  property_id: number | null;
  deal_id: number | null;
  event_type: EventType | null;
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

  const startMs = Math.min(new Date(source.start_time).getTime(), new Date(target.start_time).getTime());
  const endMs = Math.max(new Date(source.end_time).getTime(), new Date(target.end_time).getTime());
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
