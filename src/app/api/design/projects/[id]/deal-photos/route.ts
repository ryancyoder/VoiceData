import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { dealPhotoUrl } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string }> };

// Jobsite photos a design can use as its background. Photos are reached the
// canonical way — via events attached to the design's deal (and, when the
// design is also property-linked, events at that property) — since a photo's
// deal_id is only populated when its event is deal-attached. Videos are
// excluded; only real photos make sense as a background.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: project, error: projErr } = await supabase
    .from("pp_projects")
    .select("deal_id, property_id")
    .eq("id", id)
    .maybeSingle();
  if (projErr) {
    return NextResponse.json({ error: projErr.message }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const dealId = project.deal_id as number | null;
  const propertyId = project.property_id as number | null;
  if (dealId == null && propertyId == null) {
    return NextResponse.json({ photos: [] });
  }

  const PHOTO_SELECT =
    "id, storage_path, caption, media_type, taken_at, created_at, events!inner(deal_id, property_id)";

  const queries = [];
  if (dealId != null) {
    queries.push(
      supabase.from("deal_photos").select(PHOTO_SELECT).eq("media_type", "photo").eq("events.deal_id", dealId)
    );
  }
  if (propertyId != null) {
    queries.push(
      supabase.from("deal_photos").select(PHOTO_SELECT).eq("media_type", "photo").eq("events.property_id", propertyId)
    );
  }

  const results = await Promise.all(queries);
  const err = results.find((r) => r.error)?.error;
  if (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // Dedupe by photo id across the deal and property queries.
  const seen = new Set<number>();
  const photos: { id: number; url: string; caption: string | null; taken_at: string | null }[] = [];
  for (const res of results) {
    for (const row of res.data ?? []) {
      const pid = row.id as number;
      if (seen.has(pid)) continue;
      seen.add(pid);
      photos.push({
        id: pid,
        url: dealPhotoUrl(row.storage_path as string),
        caption: (row.caption as string | null) ?? null,
        taken_at: (row.taken_at as string | null) ?? null,
      });
    }
  }

  // Newest capture first.
  photos.sort((a, b) => {
    const ta = a.taken_at ? new Date(a.taken_at).getTime() : 0;
    const tb = b.taken_at ? new Date(b.taken_at).getTime() : 0;
    return tb - ta;
  });

  return NextResponse.json({ photos });
}
