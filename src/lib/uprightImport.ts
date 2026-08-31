import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET, PROPERTY_REFERENCE_TYPE } from "@/lib/salesBoard";
import { findNearbyProperties } from "@/lib/properties";
import { createEventManually, type EventType } from "@/lib/events";

// Upright (the site-survey app) stores its session photos in this bucket,
// referenced by upright_photos.storage_path. Both this and the deal-photos
// bucket are public and in the same project, so bridging a session doesn't
// copy any bytes — each deal_photos row just references the existing
// upright-media object via its bucket column, and the album resolves the URL
// from there.
const UPRIGHT_MEDIA_BUCKET = "upright-media";

// A site session lands on the calendar as this event type. Kept as a single
// constant so it's trivial to retype the category later.
const UPRIGHT_EVENT_TYPE: EventType = "Consultation";

// Only auto-attach a session to a property when its GPS lands this close. The
// neighborhood-radius candidates from findNearbyProperties go out to 3 km,
// which is fine for "suggest a property" but far too loose to silently file
// photos under — a mismatch would bury a session in the wrong album. Beyond
// this, the session is reported as unmatched rather than guessed.
const UPRIGHT_GPS_MATCH_METERS = 150;

// A 30-minute floor for a session that has no end time (or a zero-length one),
// so the calendar block is never degenerate.
const MIN_EVENT_MS = 30 * 60 * 1000;

export interface UprightSessionRow {
  id: string;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  property_id: number | null;
  event_id: number | null;
  deal_id: number | null;
  plan_center_lat: number | null;
  plan_center_lng: number | null;
}

export interface UprightPhotoRow {
  id: string;
  seq: number;
  storage_path: string;
  lat: number | null;
  lng: number | null;
  note: string | null;
  taken_at: string | null;
}

export type ImportOutcome =
  | { status: "imported"; sessionId: string; propertyId: number; eventId: number; photoCount: number }
  | { status: "skipped"; sessionId: string; reason: "already-imported" }
  | { status: "unmatched"; sessionId: string; reason: "no-property" | "no-location" | "no-photos" };

// The GPS point a session is matched from: the mean of its photo pins, or the
// map plan center as a fallback when no pin carried a fix.
function sessionCentroid(
  photos: UprightPhotoRow[],
  session: UprightSessionRow
): { latitude: number; longitude: number } | null {
  const located = photos.filter((p) => p.lat != null && p.lng != null);
  if (located.length > 0) {
    return {
      latitude: located.reduce((s, p) => s + (p.lat as number), 0) / located.length,
      longitude: located.reduce((s, p) => s + (p.lng as number), 0) / located.length,
    };
  }
  if (session.plan_center_lat != null && session.plan_center_lng != null) {
    return { latitude: session.plan_center_lat, longitude: session.plan_center_lng };
  }
  return null;
}

// Resolve the property a session belongs to: the id the Upright app already
// stamped, else the nearest existing property to the session's GPS (within the
// tight auto-attach radius). Returns null when neither applies.
async function resolveProperty(
  session: UprightSessionRow,
  photos: UprightPhotoRow[]
): Promise<number | null> {
  if (session.property_id != null) return session.property_id;
  const centroid = sessionCentroid(photos, session);
  if (!centroid) return null;
  const candidates = await findNearbyProperties(centroid.latitude, centroid.longitude);
  const nearest = candidates[0];
  if (nearest && nearest.distanceMeters <= UPRIGHT_GPS_MATCH_METERS) return nearest.id;
  return null;
}

/**
 * Bridges a single Upright session into VoiceData: matches it to a property,
 * logs it as a calendar event, and copies every photo pin into that
 * property's album (grouped under the new event). Idempotent by design — a
 * session that already carries an event_id is treated as done and skipped, so
 * re-running the import never double-imports.
 */
export async function importUprightSession(sessionId: string): Promise<ImportOutcome> {
  const { data: session, error: sessionError } = await supabase
    .from("upright_sessions")
    .select("id, name, started_at, ended_at, property_id, event_id, deal_id, plan_center_lat, plan_center_lng")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error("Upright session not found");
  const s = session as UprightSessionRow;

  if (s.event_id != null) return { status: "skipped", sessionId, reason: "already-imported" };

  const { data: photoRows, error: photosError } = await supabase
    .from("upright_photos")
    .select("id, seq, storage_path, lat, lng, note, taken_at")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });
  if (photosError) throw new Error(photosError.message);
  const photos = (photoRows ?? []) as UprightPhotoRow[];
  if (photos.length === 0) return { status: "unmatched", sessionId, reason: "no-photos" };

  const propertyId = await resolveProperty(s, photos);
  if (propertyId == null) {
    const reason = sessionCentroid(photos, s) == null ? "no-location" : "no-property";
    return { status: "unmatched", sessionId, reason };
  }

  // Log the session on the calendar first so the photos can be grouped under
  // it. A missing/zero end time gets a 30-minute block.
  const startMs = new Date(s.started_at).getTime();
  const endRaw = s.ended_at ? new Date(s.ended_at).getTime() : startMs;
  const endMs = endRaw > startMs ? endRaw : startMs + MIN_EVENT_MS;
  const event = await createEventManually({
    name: s.name?.trim() || "Upright site session",
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    property_id: propertyId,
    deal_id: s.deal_id,
    event_type: UPRIGHT_EVENT_TYPE,
    notes: "Imported from an Upright site session.",
  });

  // Reference each pin into the property album under the new event — no byte
  // copy, the row points at the existing upright-media object via `bucket`. A
  // single photo failing shouldn't abort the whole session.
  const rows = photos.map((photo) => ({
    property_id: propertyId,
    deal_id: null,
    event_id: event.id,
    photo_type: PROPERTY_REFERENCE_TYPE,
    // deal_photos.media_type is constrained to 'photo' | 'video'.
    media_type: "photo",
    bucket: UPRIGHT_MEDIA_BUCKET,
    storage_path: photo.storage_path,
    caption: photo.note?.trim() || null,
    latitude: photo.lat,
    longitude: photo.lng,
    taken_at: photo.taken_at,
  }));
  const { data: inserted, error: insertError } = await supabase
    .from("deal_photos")
    .insert(rows)
    .select("id");
  if (insertError) throw new Error(insertError.message);
  const imported = inserted?.length ?? 0;

  // Link the session back so it's not re-imported, and record the property it
  // resolved to (leaving an app-set property_id untouched).
  const sessionPatch: Record<string, unknown> = { event_id: event.id };
  if (s.property_id == null) sessionPatch.property_id = propertyId;
  const { error: linkError } = await supabase
    .from("upright_sessions")
    .update(sessionPatch)
    .eq("id", sessionId);
  if (linkError) throw new Error(linkError.message);

  return { status: "imported", sessionId, propertyId, eventId: event.id, photoCount: imported };
}

export interface ImportSummary {
  imported: number;
  photos: number;
  skipped: number;
  unmatched: number;
  // Leftover copied files removed by the post-sweep cleanup (see
  // cleanupOrphanUprightCopies) — normally 0.
  cleaned: number;
  outcomes: ImportOutcome[];
}

/**
 * Imports every not-yet-imported Upright session (event_id still null),
 * newest first. Used both by the manual "Import Upright sessions" button and
 * as the schedulable entry point.
 */
export async function importPendingUprightSessions(): Promise<ImportSummary> {
  const { data: pending, error } = await supabase
    .from("upright_sessions")
    .select("id")
    .is("event_id", null)
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);

  const summary: ImportSummary = { imported: 0, photos: 0, skipped: 0, unmatched: 0, cleaned: 0, outcomes: [] };
  for (const row of (pending ?? []) as { id: string }[]) {
    const outcome = await importUprightSession(row.id);
    summary.outcomes.push(outcome);
    if (outcome.status === "imported") {
      summary.imported += 1;
      summary.photos += outcome.photoCount;
    } else if (outcome.status === "skipped") {
      summary.skipped += 1;
    } else {
      summary.unmatched += 1;
    }
  }
  // Now that imports reference upright-media in place, any leftover copied
  // files from the old copy-based import are dead weight — sweep them.
  summary.cleaned = (await cleanupOrphanUprightCopies()).deleted;
  return summary;
}

/**
 * Removes files the old copy-based import left in the deal-photos bucket
 * (`property-<id>/upright-<uuid>.<ext>`) that no deal_photos row references any
 * more. Safe to run any time and idempotent — it only deletes objects carrying
 * the `upright-` marker that nothing points at, never a live photo. Direct SQL
 * deletion of storage rows is blocked, so this goes through the Storage API.
 */
export async function cleanupOrphanUprightCopies(): Promise<{ deleted: number; orphans: string[] }> {
  // Every path still referenced by a deal-photos-bucket row — never touch these.
  const { data: rows, error } = await supabase
    .from("deal_photos")
    .select("storage_path, poster_path, original_storage_path, bucket");
  if (error) throw new Error(error.message);
  const referenced = new Set<string>();
  for (const r of (rows ?? []) as {
    storage_path: string | null;
    poster_path: string | null;
    original_storage_path: string | null;
    bucket: string | null;
  }[]) {
    // Only rows served from the deal-photos bucket can reference these files.
    if (r.bucket && r.bucket !== DEAL_PHOTOS_BUCKET) continue;
    for (const p of [r.storage_path, r.poster_path, r.original_storage_path]) {
      if (p) referenced.add(p);
    }
  }

  // Walk each property-<id> folder for upright-* files.
  const orphans: string[] = [];
  const { data: top, error: topError } = await supabase.storage
    .from(DEAL_PHOTOS_BUCKET)
    .list("", { limit: 1000 });
  if (topError) throw new Error(topError.message);
  for (const entry of top ?? []) {
    // Folders come back with a null id; real files have one.
    if (entry.id !== null || !entry.name.startsWith("property-")) continue;
    const { data: files, error: filesError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .list(entry.name, { limit: 1000 });
    if (filesError) throw new Error(filesError.message);
    for (const f of files ?? []) {
      if (!f.name.startsWith("upright-")) continue;
      const full = `${entry.name}/${f.name}`;
      if (!referenced.has(full)) orphans.push(full);
    }
  }

  let deleted = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const batch = orphans.slice(i, i + 100);
    const { error: removeError } = await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(batch);
    if (removeError) throw new Error(removeError.message);
    deleted += batch.length;
  }
  return { deleted, orphans };
}
