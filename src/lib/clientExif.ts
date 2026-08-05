import exifr from "exifr";
import { withTimeout } from "@/lib/withTimeout";

const GPS_READ_TIMEOUT_MS = 6000;

// Reads GPS + capture-time from the ORIGINAL file, before any compression
// happens — canvas-based compression re-encodes the image and strips all
// EXIF metadata, so this must run first and the results carried separately.
export async function readClientExif(file: File) {
  try {
    const exif = await withTimeout(
      exifr.parse(file, { gps: true, exif: true, ifd1: false, icc: false, iptc: false, xmp: false, interop: false }),
      GPS_READ_TIMEOUT_MS,
      "EXIF read"
    );
    const gps =
      exif && typeof exif.latitude === "number" && typeof exif.longitude === "number"
        ? { latitude: exif.latitude, longitude: exif.longitude }
        : null;
    const captured = exif?.DateTimeOriginal ?? exif?.CreateDate;
    const takenAt = captured instanceof Date && !isNaN(captured.getTime()) ? captured.toISOString() : null;
    return { gps, takenAt };
  } catch {
    /* no readable EXIF, or the read timed out — fall back to manual deal selection */
    return { gps: null, takenAt: null };
  }
}
