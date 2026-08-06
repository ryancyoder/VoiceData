import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { haversineMeters } from "@/lib/geocode";

const MAX_MATCH_DISTANCE_METERS = 3000;
const MAX_CANDIDATES = 8;

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

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { latitude?: unknown; longitude?: unknown };
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "latitude and longitude are required" }, { status: 400 });
  }

  const [propertiesRes, eventsRes] = await Promise.all([
    supabase.from("properties").select("id, address, latitude, longitude, contacts(last_name)"),
    supabase.from("events").select("property_id, latitude, longitude").not("property_id", "is", null),
  ]);

  if (propertiesRes.error) {
    return NextResponse.json({ error: propertiesRes.error.message }, { status: 500 });
  }
  if (eventsRes.error) {
    return NextResponse.json({ error: eventsRes.error.message }, { status: 500 });
  }

  const properties = (propertiesRes.data ?? []) as unknown as PropertyRow[];
  const events = (eventsRes.data ?? []) as EventRow[];

  const eventCentroidByProperty = new Map<number, { latitude: number; longitude: number }>();
  const sums = new Map<number, { latSum: number; lonSum: number; count: number }>();
  for (const event of events) {
    if (event.property_id == null || event.latitude == null || event.longitude == null) continue;
    const entry = sums.get(event.property_id) ?? { latSum: 0, lonSum: 0, count: 0 };
    entry.latSum += event.latitude;
    entry.lonSum += event.longitude;
    entry.count += 1;
    sums.set(event.property_id, entry);
  }
  for (const [propertyId, entry] of sums) {
    eventCentroidByProperty.set(propertyId, { latitude: entry.latSum / entry.count, longitude: entry.lonSum / entry.count });
  }

  const candidates = properties
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
    .filter((c): c is NonNullable<typeof c> => c != null && c.distanceMeters <= MAX_MATCH_DISTANCE_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_CANDIDATES);

  return NextResponse.json({ candidates });
}
