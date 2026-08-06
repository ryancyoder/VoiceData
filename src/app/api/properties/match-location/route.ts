import { NextRequest, NextResponse } from "next/server";
import { findNearbyProperties } from "@/lib/properties";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { latitude?: unknown; longitude?: unknown };
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "latitude and longitude are required" }, { status: 400 });
  }

  try {
    const candidates = await findNearbyProperties(latitude, longitude);
    return NextResponse.json({ candidates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to match location" }, { status: 500 });
  }
}
