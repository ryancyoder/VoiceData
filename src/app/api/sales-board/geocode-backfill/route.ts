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

interface UngeocodedRow {
  jobsite_address: string;
}

async function ungeocodedAddresses(): Promise<string[]> {
  const { data, error } = await supabase
    .from("Sales Board")
    .select("jobsite_address")
    .not("jobsite_address", "is", null)
    .is("geocoded_at", null);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as UngeocodedRow[];
  const addresses = new Set<string>();
  for (const row of rows) {
    const addr = row.jobsite_address?.trim();
    if (addr) addresses.add(addr);
  }
  return Array.from(addresses);
}

export async function GET() {
  try {
    const addresses = await ungeocodedAddresses();
    return NextResponse.json({ remaining: addresses.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to check status" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(20, Number(searchParams.get("limit")) || DEFAULT_BATCH_SIZE));

  let addresses: string[];
  try {
    addresses = await ungeocodedAddresses();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load addresses" }, { status: 500 });
  }

  const batch = addresses.slice(0, limit);
  const results: { address: string; matched: boolean; dealsUpdated: number }[] = [];

  for (let i = 0; i < batch.length; i++) {
    const address = batch[i];
    if (i > 0) await sleep(RATE_LIMIT_DELAY_MS);

    const geocoded = await geocodeAddress(address);
    const { data, error } = await supabase
      .from("Sales Board")
      .update({
        latitude: geocoded?.latitude ?? null,
        longitude: geocoded?.longitude ?? null,
        geocoded_at: new Date().toISOString(),
      })
      .eq("jobsite_address", address)
      .select("id");

    if (error) {
      results.push({ address, matched: false, dealsUpdated: 0 });
      continue;
    }
    results.push({ address, matched: geocoded != null, dealsUpdated: data?.length ?? 0 });
  }

  const remaining = Math.max(0, addresses.length - batch.length);
  return NextResponse.json({ processed: results, remaining });
}
