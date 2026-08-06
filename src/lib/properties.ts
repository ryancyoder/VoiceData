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

/**
 * Finds the Property row for an exact jobsite address, creating one
 * (and geocoding it) if this is the first deal ever seen at that address.
 * Reusing an existing property avoids re-geocoding the same address on
 * every deal that shares it.
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

  const geocoded = await geocodeAddress(trimmed);

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
