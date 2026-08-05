import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { haversineMeters } from "@/lib/geocode";

const MAX_MATCH_DISTANCE_METERS = 3000;
const MAX_CANDIDATES = 8;

interface DealRow {
  id: number;
  deal_name: string;
  company: string | null;
  jobsite_address: string | null;
  stage: string;
  lost_at: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface PhotoRow {
  deal_id: number;
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

  const [dealsRes, photosRes] = await Promise.all([
    supabase
      .from("Sales Board")
      .select("id, deal_name, company, jobsite_address, stage, lost_at, latitude, longitude"),
    supabase.from("deal_photos").select("deal_id, latitude, longitude"),
  ]);

  if (dealsRes.error) {
    return NextResponse.json({ error: dealsRes.error.message }, { status: 500 });
  }
  if (photosRes.error) {
    return NextResponse.json({ error: photosRes.error.message }, { status: 500 });
  }

  const deals = (dealsRes.data ?? []) as DealRow[];
  const photos = (photosRes.data ?? []) as PhotoRow[];

  const photoCentroidByDeal = new Map<number, { latitude: number; longitude: number }>();
  const sums = new Map<number, { latSum: number; lonSum: number; count: number }>();
  for (const photo of photos) {
    if (photo.latitude == null || photo.longitude == null) continue;
    const entry = sums.get(photo.deal_id) ?? { latSum: 0, lonSum: 0, count: 0 };
    entry.latSum += photo.latitude;
    entry.lonSum += photo.longitude;
    entry.count += 1;
    sums.set(photo.deal_id, entry);
  }
  for (const [dealId, entry] of sums) {
    photoCentroidByDeal.set(dealId, { latitude: entry.latSum / entry.count, longitude: entry.lonSum / entry.count });
  }

  const candidates = deals
    .map((deal) => {
      const distances: { distance: number; source: "address" | "photos" }[] = [];
      if (deal.latitude != null && deal.longitude != null) {
        distances.push({
          distance: haversineMeters(latitude, longitude, deal.latitude, deal.longitude),
          source: "address",
        });
      }
      const centroid = photoCentroidByDeal.get(deal.id);
      if (centroid) {
        distances.push({
          distance: haversineMeters(latitude, longitude, centroid.latitude, centroid.longitude),
          source: "photos",
        });
      }
      if (distances.length === 0) return null;

      const best = distances.reduce((a, b) => (b.distance < a.distance ? b : a));
      return {
        id: deal.id,
        deal_name: deal.deal_name,
        company: deal.company,
        jobsite_address: deal.jobsite_address,
        stage: deal.stage,
        isLost: deal.lost_at != null,
        distanceMeters: Math.round(best.distance),
        matchedBy: best.source,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null && c.distanceMeters <= MAX_MATCH_DISTANCE_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_CANDIDATES);

  return NextResponse.json({ candidates });
}
