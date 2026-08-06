import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";
import { findNearbyProperties } from "@/lib/properties";

// Geocodes a free-form address (e.g. parsed from a pasted Outlook invite)
// and looks for an existing property nearby, the same way photo import
// matches a photo's GPS against properties on file — an address string
// alone can't reliably be compared against what's already stored (different
// formatting, abbreviations, a missing/extra zip or country), but the
// geocoded point can.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { address?: unknown };
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const geocoded = await geocodeAddress(address);
    if (!geocoded) {
      return NextResponse.json({ candidates: [], latitude: null, longitude: null });
    }
    const candidates = await findNearbyProperties(geocoded.latitude, geocoded.longitude);
    return NextResponse.json({ candidates, latitude: geocoded.latitude, longitude: geocoded.longitude });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to match address" }, { status: 500 });
  }
}
