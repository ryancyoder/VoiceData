import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { linkToPropertyEvent, EVENT_TYPES, type EventType } from "@/lib/events";
import { safeExtension } from "@/lib/storagePaths";
import { resolvePhotoMetadata } from "@/lib/photoMetadata";

// A photo's base-level attachment from general import is a property (or no
// location at all), never a deal directly — a deal is something the
// resulting event may be attached to afterward, via the event's own edit
// form. This mirrors the deal-scoped photos route but keys event resolution
// off propertyId instead of dealId.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  const caption = formData.get("caption");
  const propertyIdRaw = formData.get("propertyId");
  const propertyId =
    typeof propertyIdRaw === "string" && propertyIdRaw.trim() && Number.isFinite(Number(propertyIdRaw))
      ? Number(propertyIdRaw)
      : null;
  const eventTypeRaw = formData.get("eventType");
  const eventType: EventType | null =
    typeof eventTypeRaw === "string" && (EVENT_TYPES as readonly string[]).includes(eventTypeRaw)
      ? (eventTypeRaw as EventType)
      : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  try {
    const { latitude, longitude, takenAt } = await resolvePhotoMetadata(formData, file);

    const ext = safeExtension(file.name);
    const path = `import/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });

    if (uploadError) {
      console.error("Photo upload failed (storage):", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

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
      await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([path]);
      return NextResponse.json({ error: "Failed to attach photo to an event" }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("deal_photos")
      .insert({
        deal_id: resolvedDealId,
        event_id: eventId,
        storage_path: path,
        caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
        latitude,
        longitude,
        taken_at: takenAt,
        is_outlier: isOutlier,
      })
      .select()
      .single();

    if (error) {
      console.error("Photo upload failed (db insert):", error);
      await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ photo: data }, { status: 201 });
  } catch (err) {
    console.error("Photo upload failed (unexpected):", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload photo" },
      { status: 500 }
    );
  }
}
