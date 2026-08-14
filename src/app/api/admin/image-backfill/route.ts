import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { PLANT_IMAGES_BUCKET } from "@/lib/plants";

// One-time image-compression backfill support. GET scans a bucket and returns
// the objects worth recompressing (larger than a threshold); POST overwrites a
// single object in place with the client-recompressed bytes (optionally copying
// the original into an archive prefix first); DELETE purges that archive. The
// heavy lifting (canvas downscale/re-encode) happens in the browser — see
// ImageBackfillClient — so this route stays a thin, service-role-backed storage
// helper. Every live path is preserved exactly, so all DB references
// (deal_photos.storage_path, plants.image) keep resolving. All routes sit
// behind the app password gate (middleware.ts), so no extra auth token here.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_BUCKETS = [DEAL_PHOTOS_BUCKET, PLANT_IMAGES_BUCKET];
const DEFAULT_THRESHOLD = 600_000;

// Originals are copied here (within the same bucket) before being overwritten,
// so a compressed image can be rolled back until this prefix is purged. It's
// excluded from scans so archived originals are never themselves recompressed.
const ARCHIVE_FOLDER = "_backfill-originals";
const ARCHIVE_PREFIX = `${ARCHIVE_FOLDER}/`;

type FileEntry = { path: string; size: number };
type RawEntry = { name: string; id: string | null; metadata: { size?: number } | null };

// Storage list() is per-prefix and not recursive, so walk folders ourselves.
// Folders come back with a null id / null metadata; real files carry a size.
// skipArchive keeps the archive prefix out of the live scan; archive listing
// passes it false and starts from ARCHIVE_FOLDER.
async function listAll(bucket: string, prefix = "", skipArchive = true): Promise<FileEntry[]> {
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const threshold = Number(searchParams.get("threshold")) || DEFAULT_THRESHOLD;
  const scope = searchParams.get("scope"); // "archive" lists the archive instead
  const bucketParam = searchParams.get("bucket");
  const buckets = bucketParam ? [bucketParam] : ALLOWED_BUCKETS;
  for (const b of buckets) {
    if (!ALLOWED_BUCKETS.includes(b)) {
      return NextResponse.json({ error: `bucket not allowed: ${b}` }, { status: 400 });
    }
  }

  try {
    const items: { bucket: string; path: string; size: number }[] = [];
    let totalBytes = 0;
    for (const bucket of buckets) {
      const files =
        scope === "archive"
          ? await listAll(bucket, ARCHIVE_FOLDER, false)
          : await listAll(bucket);
      for (const f of files) {
        // Archive listing returns everything; live scan filters by size.
        if (scope === "archive" || f.size > threshold) {
          items.push({ bucket, path: f.path, size: f.size });
          totalBytes += f.size;
        }
      }
    }
    items.sort((a, b) => b.size - a.size);
    return NextResponse.json({ items, count: items.length, totalBytes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "scan failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const bucket = String(form.get("bucket") ?? "");
  const path = String(form.get("path") ?? "");
  const archive = String(form.get("archive") ?? "") === "1";
  const file = form.get("file");

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: "bucket not allowed" }, { status: 400 });
  }
  if (!path || !(file instanceof File)) {
    return NextResponse.json({ error: "path and file are required" }, { status: 400 });
  }
  if (path === ARCHIVE_FOLDER || path.startsWith(ARCHIVE_PREFIX)) {
    return NextResponse.json({ error: "refusing to overwrite an archived original" }, { status: 400 });
  }

  // Copy the current (still-original) object into the archive BEFORE overwriting,
  // so a failure here aborts the overwrite and the original is never lost. A
  // pre-existing archive entry (from an earlier run) is left intact.
  if (archive) {
    const { error: copyErr } = await supabase.storage.from(bucket).copy(path, ARCHIVE_PREFIX + path);
    if (copyErr && !/exist/i.test(copyErr.message)) {
      return NextResponse.json({ error: `archive failed: ${copyErr.message}` }, { status: 500 });
    }
  }

  // Overwrite in place (same path → all DB references stay valid). The bytes
  // are JPEG (canvas re-encode), so the object's content-type becomes jpeg
  // regardless of the original extension, which readers resolve by path anyway.
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, contentType: "image/jpeg" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, size: file.size, archived: archive });
}

// Purge archived originals to actually reclaim the space they occupy. Only ever
// touches objects under the archive prefix.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bucketParam = searchParams.get("bucket");
  const buckets = bucketParam ? [bucketParam] : ALLOWED_BUCKETS;
  for (const b of buckets) {
    if (!ALLOWED_BUCKETS.includes(b)) {
      return NextResponse.json({ error: `bucket not allowed: ${b}` }, { status: 400 });
    }
  }

  try {
    let removed = 0;
    let freedBytes = 0;
    for (const bucket of buckets) {
      const files = await listAll(bucket, ARCHIVE_FOLDER, false);
      const paths = files.map((f) => f.path).filter((p) => p.startsWith(ARCHIVE_PREFIX));
      for (let i = 0; i < paths.length; i += 500) {
        const chunk = paths.slice(i, i + 500);
        const { error } = await supabase.storage.from(bucket).remove(chunk);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      removed += files.length;
      freedBytes += files.reduce((sum, f) => sum + f.size, 0);
    }
    return NextResponse.json({ ok: true, removed, freedBytes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "purge failed" },
      { status: 500 }
    );
  }
}
