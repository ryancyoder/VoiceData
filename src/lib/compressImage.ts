/**
 * Downscales and re-encodes an image client-side before upload. Vercel's
 * serverless functions cap request bodies at ~4.5MB — modern phone photos
 * (especially HEIC originals decoded to JPEG, or ProRAW) routinely exceed
 * that, causing the upload request itself to be rejected by the platform
 * before our route code ever runs. Compressing here keeps uploads well
 * under that ceiling regardless of the original file's size.
 *
 * This strips EXIF metadata (canvas re-encoding always does) — callers
 * that need GPS/capture-time data must read it from the original file
 * beforehand and pass it along separately.
 */
export async function compressImage(
  file: File,
  options: { maxDimension?: number; quality?: number; skipBelowBytes?: number } = {}
): Promise<File> {
  const { maxDimension = 2000, quality = 0.82, skipBelowBytes = 1_500_000 } = options;

  if (!file.type.startsWith("image/") || file.size <= skipBelowBytes) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    // Decoding failed (unsupported format, corrupt file, etc.) — upload the original.
    return file;
  }
}
