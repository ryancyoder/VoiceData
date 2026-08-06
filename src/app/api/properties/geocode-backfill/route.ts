import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { geocodeAddress } from "@/lib/geocode";

// Nominatim's usage policy caps requests at 1/sec, so batches are processed
// slowly and kept small enough to finish comfortably inside a serverless
// function's execution window. The client calls this repeatedly until
// `remaining` hits 0.
const DEFAULT_BATCH_SIZE = 5;
const RATE_LIMIT_DELAY_MS = 1100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UngeocodedProperty {
  id: number;
  address: string;
}

// Ungeocoded means "no coordinates on file" rather than "never attempted" —
// findOrCreateProperty stamps geocoded_at on every property it creates
// whether or not the geocode call actually succeeded, so checking
// geocoded_at alone would silently skip properties whose first attempt
// failed (a Nominatim miss, a timeout) and never retry them.
async function ungeocodedProperties(): Promise<UngeocodedProperty[]> {
  const { data, error } = await supabase.from("properties").select("id, address").is("latitude", null);

  if (error) throw new Error(error.message);
  return (data ?? []) as UngeocodedProperty[];
}

export async function GET() {
  try {
    const properties = await ungeocodedProperties();
    return NextResponse.json({ remaining: properties.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to check status" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(20, Number(searchParams.get("limit")) || DEFAULT_BATCH_SIZE));

  let properties: UngeocodedProperty[];
  try {
    properties = await ungeocodedProperties();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load properties" }, { status: 500 });
  }

  const batch = properties.slice(0, limit);
  const results: { address: string; matched: boolean }[] = [];

  for (let i = 0; i < batch.length; i++) {
    const property = batch[i];
    if (i > 0) await sleep(RATE_LIMIT_DELAY_MS);

    const geocoded = await geocodeAddress(property.address);
    const { error } = await supabase
      .from("properties")
      .update({
        latitude: geocoded?.latitude ?? null,
        longitude: geocoded?.longitude ?? null,
        geocoded_at: new Date().toISOString(),
      })
      .eq("id", property.id);

    if (error) {
      results.push({ address: property.address, matched: false });
      continue;
    }
    results.push({ address: property.address, matched: geocoded != null });
  }

  const remaining = Math.max(0, properties.length - batch.length);
  return NextResponse.json({ processed: results, remaining });
}
