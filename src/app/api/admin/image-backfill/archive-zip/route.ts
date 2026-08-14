import { NextRequest, NextResponse } from "next/server";
import { zipSync, type Zippable } from "fflate";
import { supabase } from "@/lib/supabaseClient";
import { ALLOWED_BUCKETS, ARCHIVE_FOLDER, ARCHIVE_PREFIX, listAll } from "@/lib/imageBackfill";

// Downloads a batch of archived originals as a single .zip, streamed with a
// Content-Disposition so it saves straight to disk (reliable on iOS Safari,
// where blob-URL downloads are flaky). The batch is addressed by offset/limit
// over the archive listing sorted by path, so the client only needs the total
// count to lay out batch links — no long lists of paths in the URL. Read-only.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") ?? "";
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT));

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: "bucket not allowed" }, { status: 400 });
  }

  try {
    const files = (await listAll(bucket, ARCHIVE_FOLDER, false))
      .filter((f) => f.path.startsWith(ARCHIVE_PREFIX))
      .sort((a, b) => a.path.localeCompare(b.path));
    const batch = files.slice(offset, offset + limit);
    if (batch.length === 0) {
      return NextResponse.json({ error: "no files in this batch" }, { status: 404 });
    }

    // Download the batch in parallel, then zip in memory. JPEGs are already
    // compressed, so store them (level 0) — faster and no real size gain.
    const entries = await Promise.all(
      batch.map(async (f) => {
        const { data, error } = await supabase.storage.from(bucket).download(f.path);
        if (error || !data) throw new Error(`download ${f.path}: ${error?.message ?? "not found"}`);
        const bytes = new Uint8Array(await data.arrayBuffer());
        // Keep the original folder structure under the archive prefix.
        return [f.path.slice(ARCHIVE_PREFIX.length), bytes] as const;
      })
    );

    const zippable: Zippable = {};
    for (const [name, bytes] of entries) zippable[name] = [bytes, { level: 0 }];
    const zip = zipSync(zippable);

    const batchNo = Math.floor(offset / limit) + 1;
    const filename = `${bucket}-originals-${batchNo}.zip`;
    return new NextResponse(Buffer.from(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "zip failed" },
      { status: 500 }
    );
  }
}
