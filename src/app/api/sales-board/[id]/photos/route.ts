import { NextRequest, NextResponse } from "next/server";
import exifr from "exifr";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { withTimeout } from "@/lib/withTimeout";
import { linkToEvent } from "@/lib/events";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

const EXIF_TIMEOUT_MS = 8000;

async function readExif(file: File) {
  let latitude: number | null = null;
  let longitude: number | null = null;
  let takenAt: string | null = null;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Only the segments we actually use — skips thumbnail/ICC/IPTC/XMP,
    // which can be large and slow to parse on real camera photos.
    const exif = await withTimeout(
      exifr.parse(buffer, { gps: true, exif: true, ifd1: false, icc: false, iptc: false, xmp: false, interop: false }),
      EXIF_TIMEOUT_MS,
      "EXIF parse"
    );
    if (typeof exif?.latitude === "number" && typeof exif?.longitude === "number") {
      latitude = exif.latitude;
      longitude = exif.longitude;
    }
    const captured = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (captured instanceof Date && !isNaN(captured.getTime())) {
      takenAt = captured.toISOString();
    }
  } catch {
    // No readable EXIF data, or parsing timed out — proceed without it.
    // This must never block the actual upload.
  }

  return { latitude, longitude, takenAt };
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file");
  const caption = formData.get("caption");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  try {
    // The client reads EXIF from the original photo before compressing it
    // for upload (compression re-encodes the image, which strips metadata),
    // so prefer those client-supplied values when present. Fall back to
    // reading EXIF from the uploaded file ourselves otherwise.
    let latitude: number | null = null;
    let longitude: number | null = null;
    let takenAt: string | null = null;

    const clientLat = formData.get("latitude");
    const clientLng = formData.get("longitude");
    if (typeof clientLat === "string" && typeof clientLng === "string") {
      const lat = Number(clientLat);
      const lng = Number(clientLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        latitude = lat;
        longitude = lng;
      }
    }

    const clientTakenAt = formData.get("takenAt");
    if (typeof clientTakenAt === "string" && clientTakenAt) {
      const parsed = new Date(clientTakenAt);
      if (!isNaN(parsed.getTime())) takenAt = parsed.toISOString();
    }

    if (latitude === null || takenAt === null) {
      const fromFile = await readExif(file);
      if (latitude === null) {
        latitude = fromFile.latitude;
        longitude = fromFile.longitude;
      }
      if (takenAt === null) takenAt = fromFile.takenAt;
    }

    const ext = safeExtension(file.name);
    const path = `deal-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });

    if (uploadError) {
      console.error("Photo upload failed (storage):", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // If the client already knows which event this belongs to (e.g.
    // uploading straight from an event's detail view), use that directly.
    // Otherwise group this photo into an event (a site visit — same
    // time+place as other nearby photos) when we have a location for it.
    // Never blocks the upload itself if this fails.
    const clientEventId = formData.get("eventId");
    const eventId =
      typeof clientEventId === "string" && clientEventId
        ? Number(clientEventId)
        : await linkToEvent(Number(id), latitude, longitude, takenAt);

    const { data, error } = await supabase
      .from("deal_photos")
      .insert({
        deal_id: Number(id),
        storage_path: path,
        caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
        latitude,
        longitude,
        taken_at: takenAt,
        event_id: eventId,
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
