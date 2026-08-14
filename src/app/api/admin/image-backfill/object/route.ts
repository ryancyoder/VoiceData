import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { PLANT_IMAGES_BUCKET } from "@/lib/plants";

// Streams a single storage object back to the (password-gated) admin client so
// it can recompress it in the browser. Same-origin + cookie-gated, so no signed
// URLs to mint or expire mid-run. Read-only.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_BUCKETS = [DEAL_PHOTOS_BUCKET, PLANT_IMAGES_BUCKET];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") ?? "";
  const path = searchParams.get("path") ?? "";

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
  return new NextResponse(buf, {
    headers: {
      "content-type": data.type || "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}
