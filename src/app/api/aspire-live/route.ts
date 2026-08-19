import { NextResponse } from "next/server";
import { readLiveView } from "@/lib/aspireSession";

// Polled by the deal modal while an Aspire search is running. Returns the
// Browserless live-view URL for the run in progress (a page where a human can
// watch — and type into — the robot's browser), or null when nothing is
// running. The value is written by the search itself and cleared when the run
// ends; a staleness cap in readLiveView stops a crashed run's link lingering.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ live: await readLiveView() });
}
