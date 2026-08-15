import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { DealPhoto } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string }> };

// Every photo tied to a property — reference photos (property_id set) PLUS the
// photos of every event at the property PLUS the photos of every deal at the
// property — merged, de-duplicated, and sorted oldest-first. This powers the
// deal modal's photo strip, which spans the whole property's history (across
// deals), not just the open deal.
//
// deal_photos is a junction across events/deals/properties, so cross-table
// embeds risk PostgREST ambiguity (see the Photos page loader and the property
// reference-photos route for the same guard). Everything here is plain,
// single-table queries joined in code.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const propertyId = Number(id);
  if (!Number.isFinite(propertyId)) {
    return NextResponse.json({ error: "Invalid property id" }, { status: 400 });
  }

  const [eventsRes, dealsRes, propPhotosRes] = await Promise.all([
    supabase.from("events").select("id").eq("property_id", propertyId),
    supabase.from("Sales Board").select("id").eq("property_id", propertyId),
    supabase.from("deal_photos").select("*").eq("property_id", propertyId),
  ]);
  for (const r of [eventsRes, dealsRes, propPhotosRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const eventIds = (eventsRes.data ?? []).map((e) => e.id as number);
  const dealIds = (dealsRes.data ?? []).map((d) => d.id as number);

  const [evPhotosRes, dealPhotosRes] = await Promise.all([
    eventIds.length
      ? supabase.from("deal_photos").select("*").in("event_id", eventIds)
      : Promise.resolve({ data: [] as DealPhoto[], error: null }),
    dealIds.length
      ? supabase.from("deal_photos").select("*").in("deal_id", dealIds)
      : Promise.resolve({ data: [] as DealPhoto[], error: null }),
  ]);
  if (evPhotosRes.error) return NextResponse.json({ error: evPhotosRes.error.message }, { status: 500 });
  if (dealPhotosRes.error) return NextResponse.json({ error: dealPhotosRes.error.message }, { status: 500 });

  const byId = new Map<number, DealPhoto>();
  for (const p of [
    ...((propPhotosRes.data ?? []) as DealPhoto[]),
    ...((evPhotosRes.data ?? []) as DealPhoto[]),
    ...((dealPhotosRes.data ?? []) as DealPhoto[]),
  ]) {
    byId.set(p.id, p);
  }

  const sortTs = (p: DealPhoto) => new Date(p.taken_at ?? p.created_at).getTime();
  const photos = [...byId.values()].sort((a, b) => sortTs(a) - sortTs(b));

  return NextResponse.json({ photos });
}
