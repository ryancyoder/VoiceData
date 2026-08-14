import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ALLOWED_BUCKETS } from "@/lib/imageBackfill";

// Streams a single storage object back to the (password-gated) admin client.
// Used both to recompress in the browser and, with ?download=1, to save an
// individual original to disk (Content-Disposition: attachment). Read-only.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") ?? "";
  const path = searchParams.get("path") ?? "";
  const asDownload = searchParams.get("download") === "1";

  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: "bucket not allowed" }, { status: 400 });
  }
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });
  }

  const buf = await data.arrayBuffer();
  const headers: Record<string, string> = {
    "content-type": data.type || "application/octet-stream",
    "cache-control": "no-store",
  };
  if (asDownload) {
    const filename = (path.split("/").pop() || "download").replace(/"/g, "");
    headers["content-disposition"] = `attachment; filename="${filename}"`;
  }
  return new NextResponse(buf, { headers });
}
