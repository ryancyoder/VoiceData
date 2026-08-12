import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { linkToPropertyEvent, EVENT_TYPES, type EventType } from "@/lib/events";

// Called after the browser has already uploaded the video (and optional
// poster image) directly to Storage via a signed URL from upload-url/route.
// Mirrors the deal-scoped video finalize route, but resolves the event via
// a property (or "no location") instead of a deal.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    videoPath?: unknown;
    posterPath?: unknown;
    propertyId?: unknown;
    takenAt?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    caption?: unknown;
    eventType?: unknown;
  };

  const videoPath = typeof body.videoPath === "string" ? body.videoPath : "";
  if (!videoPath) {
    return NextResponse.json({ error: "videoPath is required" }, { status: 400 });
  }
  const posterPath = typeof body.posterPath === "string" && body.posterPath ? body.posterPath : null;
  const propertyId =
    typeof body.propertyId === "number"
      ? body.propertyId
      : typeof body.propertyId === "string" && body.propertyId.trim() && Number.isFinite(Number(body.propertyId))
        ? Number(body.propertyId)
        : null;

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (typeof body.latitude === "number" && typeof body.longitude === "number") {
    latitude = body.latitude;
    longitude = body.longitude;
  }

  let takenAt: string | null = null;
  if (typeof body.takenAt === "string" && body.takenAt) {
    const parsed = new Date(body.takenAt);
    if (!isNaN(parsed.getTime())) takenAt = parsed.toISOString();
  }

  const eventType: EventType | null =
    typeof body.eventType === "string" && (EVENT_TYPES as readonly string[]).includes(body.eventType)
      ? (body.eventType as EventType)
      : null;

  try {
    let eventId: number;
    let resolvedDealId: number | null;
    let isOutlier: boolean;
    try {
      const linked = await linkToPropertyEvent(propertyId, latitude, longitude, takenAt, eventType);
      eventId = linked.eventId;
      resolvedDealId = linked.dealId;
      isOutlier = linked.isOutlier;
    } catch (err) {
      console.error("Event linking failed:", err);
      await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(posterPath ? [videoPath, posterPath] : [videoPath]);
      return NextResponse.json({ error: "Failed to attach video to an event" }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("deal_photos")
      .insert({
        deal_id: resolvedDealId,
        event_id: eventId,
        storage_path: videoPath,
        poster_path: posterPath,
        media_type: "video",
        caption: typeof body.caption === "string" && body.caption.trim() ? body.caption.trim() : null,
        latitude,
        longitude,
        taken_at: takenAt,
        is_outlier: isOutlier,
      })
      .select()
      .single();

    if (error) {
      console.error("Video finalize failed (db insert):", error);
      await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(posterPath ? [videoPath, posterPath] : [videoPath]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ photo: data }, { status: 201 });
  } catch (err) {
    console.error("Video finalize failed (unexpected):", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save video" },
      { status: 500 }
    );
  }
}
