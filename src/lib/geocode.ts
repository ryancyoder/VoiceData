export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

/**
 * Geocodes a free-form address via OpenStreetMap's Nominatim (no API key
 * required). Returns null on no match, network failure, or malformed
 * response — geocoding is a best-effort enrichment, never something that
 * should block saving a deal.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "VoiceData-SalesBoard/1.0 (internal jobsite geocoding)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;

    const results = (await res.json()) as unknown;
    if (!Array.isArray(results) || results.length === 0) return null;

    const first = results[0] as { lat?: string; lon?: string };
    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return { latitude, longitude };
  } catch {
    return null;
  }
}

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, a)));
}
