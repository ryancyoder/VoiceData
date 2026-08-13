import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ photoId: string }> };

interface GroupRow {
  type?: string;
  id?: string;
  label?: string;
  sqFt?: number;
  linearFt?: number;
  height?: number;
  isPlantsGroup?: boolean;
  isItemsGroup?: boolean;
}

// Resolve the estimate that a photo's deal/property belongs to, and return its
// take-off groups plus which of them this photo is already linked to — so the
// gallery/annotator can offer "link to take-off group" from the photo side.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { photoId: photoIdRaw } = await params;
  const photoId = Number(photoIdRaw);
  if (!Number.isFinite(photoId)) return NextResponse.json({ error: "bad photo id" }, { status: 400 });

  const { data: photo, error: pErr } = await supabase
    .from("deal_photos")
    .select("id, deal_id, event_id, property_id")
    .eq("id", photoId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!photo) return NextResponse.json({ error: "photo not found" }, { status: 404 });

  let dealId: number | null = photo.deal_id ?? null;
  let propertyId: number | null = photo.property_id ?? null;
  if ((dealId == null || propertyId == null) && photo.event_id != null) {
    const { data: ev } = await supabase.from("events").select("deal_id, property_id").eq("id", photo.event_id).maybeSingle();
    if (ev) {
      dealId = dealId ?? (ev.deal_id ?? null);
      propertyId = propertyId ?? (ev.property_id ?? null);
    }
  }

  // Find the estimate: by deal (one per deal) first, else by property.
  interface EstRow {
    id: string;
    project_name: string | null;
    rows: unknown[] | null;
  }
  let estimate: EstRow | null = null;
  if (dealId != null) {
    const { data } = await supabase.from("estimates").select("id, project_name, rows").eq("deal_id", dealId).maybeSingle();
    if (data) estimate = data as unknown as EstRow;
  }
  if (!estimate && propertyId != null) {
    const { data } = await supabase
      .from("estimates")
      .select("id, project_name, rows")
      .eq("property_id", propertyId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) estimate = data[0] as unknown as EstRow;
  }

  if (!estimate) {
    return NextResponse.json({ estimate: null, groups: [], linkedGroupIds: [] });
  }

  const rows = (estimate.rows ?? []) as GroupRow[];
  const groups = rows
    .filter((r) => r.type === "group" && !r.isPlantsGroup && !r.isItemsGroup && typeof r.id === "string")
    .map((r) => ({
      id: r.id as string,
      label: (r.label && r.label.trim()) || "Untitled group",
      sqFt: r.sqFt ?? 0,
      linearFt: r.linearFt ?? 0,
      height: r.height ?? 0,
    }));

  const { data: links } = await supabase
    .from("estimate_photo_links")
    .select("group_id")
    .eq("estimate_id", estimate.id)
    .eq("photo_id", photoId);
  const linkedGroupIds = (links ?? []).map((l) => l.group_id as string);

  return NextResponse.json({
    estimateId: estimate.id,
    projectName: estimate.project_name ?? null,
    groups,
    linkedGroupIds,
  });
}
