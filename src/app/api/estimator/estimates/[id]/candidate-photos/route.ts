import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// Photos that can be linked to this estimate's take-off groups: every photo of
// the estimate's deal/property — reached directly (deal_id / property_id on the
// photo) or by way of an event at that property.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .select("deal_id, property_id")
    .eq("id", id)
    .maybeSingle();
  if (estErr) return NextResponse.json({ error: estErr.message }, { status: 500 });
  const dealId = est?.deal_id ?? null;
  const propertyId = est?.property_id ?? null;

  let eventIds: number[] = [];
  if (propertyId != null) {
    const { data: evs, error: evErr } = await supabase.from("events").select("id").eq("property_id", propertyId);
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
    eventIds = (evs ?? []).map((e) => e.id as number);
  }

  const ors: string[] = [];
  if (eventIds.length > 0) ors.push(`event_id.in.(${eventIds.join(",")})`);
  if (propertyId != null) ors.push(`property_id.eq.${propertyId}`);
  if (dealId != null) ors.push(`deal_id.eq.${dealId}`);
  if (ors.length === 0) return NextResponse.json({ photos: [] });

  const { data, error } = await supabase
    .from("deal_photos")
    .select("id, storage_path, poster_path, caption, media_type, photo_type, original_storage_path")
    .or(ors.join(","))
    .eq("media_type", "photo")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ photos: data ?? [] });
}
