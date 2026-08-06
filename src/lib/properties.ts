import { supabase } from "@/lib/supabaseClient";
import { geocodeAddress, haversineMeters } from "@/lib/geocode";
import type { Property } from "@/lib/salesBoard";

const MAX_MATCH_DISTANCE_METERS = 3000;
const MAX_CANDIDATES = 8;

export interface PropertyMatchCandidate {
  id: number;
  address: string;
  contactLastName: string | null;
  distanceMeters: number;
  matchedBy: "address" | "events";
}

interface PropertyRow {
  id: number;
  address: string;
  latitude: number | null;
  longitude: number | null;
  contacts: { last_name: string | null } | null;
}

interface EventRow {
  property_id: number | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Finds properties within MAX_MATCH_DISTANCE_METERS of a point, matched
 * either by the property's own geocoded address or by the centroid of its
 * events' own GPS — shared by the photo-import lat/lng matcher and the
 * Outlook-import address matcher below, so "does this address already
 * exist on file" means the same thing everywhere.
 */
export async function findNearbyProperties(latitude: number, longitude: number): Promise<PropertyMatchCandidate[]> {
  const [propertiesRes, eventsRes] = await Promise.all([
    supabase.from("properties").select("id, address, latitude, longitude, contacts(last_name)"),
    supabase.from("events").select("property_id, latitude, longitude").not("property_id", "is", null),
  ]);

  if (propertiesRes.error) throw new Error(propertiesRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const properties = (propertiesRes.data ?? []) as unknown as PropertyRow[];
  const events = (eventsRes.data ?? []) as EventRow[];

  const sums = new Map<number, { latSum: number; lonSum: number; count: number }>();
  for (const event of events) {
    if (event.property_id == null || event.latitude == null || event.longitude == null) continue;
    const entry = sums.get(event.property_id) ?? { latSum: 0, lonSum: 0, count: 0 };
    entry.latSum += event.latitude;
    entry.lonSum += event.longitude;
    entry.count += 1;
    sums.set(event.property_id, entry);
  }
  const eventCentroidByProperty = new Map<number, { latitude: number; longitude: number }>();
  for (const [propertyId, entry] of sums) {
    eventCentroidByProperty.set(propertyId, { latitude: entry.latSum / entry.count, longitude: entry.lonSum / entry.count });
  }

  return properties
    .map((property) => {
      const distances: { distance: number; source: "address" | "events" }[] = [];
      if (property.latitude != null && property.longitude != null) {
        distances.push({
          distance: haversineMeters(latitude, longitude, property.latitude, property.longitude),
          source: "address",
        });
      }
      const centroid = eventCentroidByProperty.get(property.id);
      if (centroid) {
        distances.push({
          distance: haversineMeters(latitude, longitude, centroid.latitude, centroid.longitude),
          source: "events",
        });
      }
      if (distances.length === 0) return null;

      const best = distances.reduce((a, b) => (b.distance < a.distance ? b : a));
      return {
        id: property.id,
        address: property.address,
        contactLastName: property.contacts?.last_name ?? null,
        distanceMeters: Math.round(best.distance),
        matchedBy: best.source,
      };
    })
    .filter((c): c is PropertyMatchCandidate => c != null && c.distanceMeters <= MAX_MATCH_DISTANCE_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_CANDIDATES);
}

const DEDUPE_MATCH_METERS = 30;

function normalizeAddressForMatch(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Catches near-duplicate wording ("114 Shore Dr" vs "114 Shore Dr.") that
 * an exact match misses — stripping punctuation/whitespace/case and
 * comparing client-side, since this table is small enough that fetching
 * it all is cheaper than maintaining a generated/indexed column for it.
 */
async function findPropertyByNormalizedAddress(trimmed: string): Promise<Property | null> {
  const target = normalizeAddressForMatch(trimmed);
  const { data, error } = await supabase.from("properties").select("*");
  if (error) throw new Error(error.message);
  return (data as Property[] | null)?.find((p) => normalizeAddressForMatch(p.address) === target) ?? null;
}

/**
 * Catches wording that differs enough to dodge normalization ("Dr" vs
 * "Drive") but still geocodes to (near enough) the same point. The radius
 * here is deliberately tight — this is for "is this the same property",
 * not the much looser "properties in the neighborhood" suggestion radius
 * used by findNearbyProperties, so it won't accidentally merge next-door
 * neighbors.
 */
async function findPropertyByGeocodedProximity(latitude: number, longitude: number): Promise<Property | null> {
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .not("latitude", "is", null)
    .not("longitude", "is", null);
  if (error) throw new Error(error.message);

  let best: { property: Property; distance: number } | null = null;
  for (const row of (data ?? []) as Property[]) {
    if (row.latitude == null || row.longitude == null) continue;
    const distance = haversineMeters(latitude, longitude, row.latitude, row.longitude);
    if (distance <= DEDUPE_MATCH_METERS && (!best || distance < best.distance)) {
      best = { property: row, distance };
    }
  }
  return best?.property ?? null;
}

/**
 * Finds the Property row for a jobsite address, creating one (and
 * geocoding it) only if this address genuinely isn't on file yet under
 * any of: an exact match, a punctuation/whitespace-insensitive match, or
 * (once geocoded) a same-point match. Reusing an existing property avoids
 * re-geocoding the same address on every deal that shares it, and avoids
 * splitting one physical property across multiple rows over wording.
 */
export async function findOrCreateProperty(address: string): Promise<Property | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const { data: existing, error: findError } = await supabase
    .from("properties")
    .select("*")
    .eq("address", trimmed)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (existing) return existing as Property;

  const normalizedMatch = await findPropertyByNormalizedAddress(trimmed);
  if (normalizedMatch) return normalizedMatch;

  const geocoded = await geocodeAddress(trimmed);

  if (geocoded) {
    const proximityMatch = await findPropertyByGeocodedProximity(geocoded.latitude, geocoded.longitude);
    if (proximityMatch) return proximityMatch;
  }

  const { data: created, error: insertError } = await supabase
    .from("properties")
    .upsert(
      {
        address: trimmed,
        latitude: geocoded?.latitude ?? null,
        longitude: geocoded?.longitude ?? null,
        geocoded_at: new Date().toISOString(),
      },
      { onConflict: "address" }
    )
    .select()
    .single();

  if (insertError) throw new Error(insertError.message);
  return created as Property;
}
