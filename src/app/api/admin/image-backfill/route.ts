import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { PLANT_IMAGES_BUCKET } from "@/lib/plants";

// One-time image-compression backfill support. GET scans a bucket and returns
// the objects worth recompressing (larger than a threshold); POST overwrites a
// single object in place with the client-recompressed bytes. The heavy lifting
// (canvas downscale/re-encode) happens in the browser — see ImageBackfillClient
// — so this route stays a thin, service-role-backed storage helper. Every path
// is preserved exactly, so all DB references (deal_photos.storage_path,
// plants.image) keep resolving. Both routes sit behind the app password gate
// (middleware.ts), so no extra auth token is needed here.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_BUCKETS = [DEAL_PHOTOS_BUCKET, PLANT_IMAGES_BUCKET];
const DEFAULT_THRESHOLD = 600_000;

type FileEntry = { path: string; size: number };
type RawEntry = { name: string; id: string | null; metadata: { size?: number } | null };

// Storage list() is per-prefix and not recursive, so walk folders ourselves.
// Folders come back with a null id / null metadata; real files carry a size.
async function listAll(bucket: string, prefix = ""): Promise<FileEntry[]> {
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
      const size = entry.metadata?.size;
      if (entry.id === null || size == null) {
        out.push(...(await listAll(bucket, path)));
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
      const files = await listAll(bucket);
      for (const f of files) {
        if (f.size > threshold) {
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
  const file = form.get("file");

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: "bucket not allowed" }, { status: 400 });
  }
  if (!path || !(file instanceof File)) {
    return NextResponse.json({ error: "path and file are required" }, { status: 400 });
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
  return NextResponse.json({ ok: true, size: file.size });
}
