import exifr from "exifr";
import { withTimeout } from "@/lib/withTimeout";

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

/**
 * Resolves a photo's GPS/capture-time, preferring values the client already
 * extracted from the original file (compression re-encodes the image before
 * upload, which strips EXIF) and falling back to reading EXIF from the
 * uploaded file ourselves otherwise.
 */
export async function resolvePhotoMetadata(
  formData: FormData,
  file: File
): Promise<{ latitude: number | null; longitude: number | null; takenAt: string | null }> {
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

  return { latitude, longitude, takenAt };
}
