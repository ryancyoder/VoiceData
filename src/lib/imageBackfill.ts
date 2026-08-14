import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { PLANT_IMAGES_BUCKET } from "@/lib/plants";

// Shared helpers for the one-time image-compression backfill routes
// (see src/app/api/admin/image-backfill/*). Kept here so the scan/overwrite,
// object-download, and archive-zip routes all agree on buckets, the archive
// prefix, and how to walk storage.

export const ALLOWED_BUCKETS = [DEAL_PHOTOS_BUCKET, PLANT_IMAGES_BUCKET];
export const DEFAULT_THRESHOLD = 600_000;

// Originals are copied here (within the same bucket) before being overwritten,
// so a compressed image can be rolled back until this prefix is purged. It's
// excluded from scans so archived originals are never themselves recompressed.
export const ARCHIVE_FOLDER = "_backfill-originals";
export const ARCHIVE_PREFIX = `${ARCHIVE_FOLDER}/`;

export type FileEntry = { path: string; size: number };
type RawEntry = { name: string; id: string | null; metadata: { size?: number } | null };

// Storage list() is per-prefix and not recursive, so walk folders ourselves.
// Folders come back with a null id / null metadata; real files carry a size.
// skipArchive keeps the archive prefix out of the live scan; archive listing
// passes it false and starts from ARCHIVE_FOLDER.
export async function listAll(bucket: string, prefix = "", skipArchive = true): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const limit = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const entry of data as unknown as RawEntry[]) {
      if (entry.name === ".emptyFolderPlaceholder") continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skipArchive && (path === ARCHIVE_FOLDER || path.startsWith(ARCHIVE_PREFIX))) continue;
      const size = entry.metadata?.size;
      if (entry.id === null || size == null) {
        out.push(...(await listAll(bucket, path, skipArchive)));
      } else {
        out.push({ path, size });
      }
    }
    if (data.length < limit) break;
    offset += data.length;
  }
  return out;
}
