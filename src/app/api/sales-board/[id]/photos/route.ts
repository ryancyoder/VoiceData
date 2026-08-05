import { NextRequest, NextResponse } from "next/server";
import exifr from "exifr";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { withTimeout } from "@/lib/withTimeout";

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

// The uploaded filename's extension ends up directly in the storage path,
// which the storage client embeds in a request URL — an unusual filename
// (unicode, stray punctuation, no extension at all) can otherwise produce
// a path that fails URL parsing deep inside the storage client, surfacing
// a cryptic "The string did not match the expected pattern." error.
function safeExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const raw = dot === -1 ? "" : fileName.slice(dot + 1);
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return cleaned || "jpg";
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
    const { latitude, longitude, takenAt } = await readExif(file);

    const ext = safeExtension(file.name);
    const path = `deal-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });

    if (uploadError) {
      console.error("Photo upload failed (storage):", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("deal_photos")
      .insert({
        deal_id: Number(id),
        storage_path: path,
        caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
        latitude,
        longitude,
        taken_at: takenAt,
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
