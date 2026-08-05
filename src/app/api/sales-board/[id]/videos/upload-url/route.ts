import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_PHOTOS_BUCKET } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

// Videos are uploaded directly from the browser to Supabase Storage using a
// signed upload URL, bypassing our own server entirely — routing a
// multi-hundred-MB file through a Next.js API route would run straight into
// Vercel's request body size limit (the same wall photo uploads hit before
// client-side compression was added). This route only hands out the
// destination paths + upload tokens; the actual bytes never touch it.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as { videoFileName?: unknown; hasPoster?: unknown };

  const videoFileName = typeof body.videoFileName === "string" ? body.videoFileName : "";
  if (!videoFileName) {
    return NextResponse.json({ error: "videoFileName is required" }, { status: 400 });
  }

  const videoExt = safeExtension(videoFileName, "mp4");
  const videoPath = `deal-${id}/${Date.now()}-${crypto.randomUUID()}.${videoExt}`;

  const { data: videoSigned, error: videoError } = await supabase.storage
    .from(DEAL_PHOTOS_BUCKET)
    .createSignedUploadUrl(videoPath);
  if (videoError) {
    return NextResponse.json({ error: videoError.message }, { status: 500 });
  }

  let poster: { path: string; token: string } | null = null;
  if (body.hasPoster) {
    const posterPath = `deal-${id}/${Date.now()}-${crypto.randomUUID()}-poster.jpg`;
    const { data: posterSigned, error: posterError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .createSignedUploadUrl(posterPath);
    if (posterError) {
      return NextResponse.json({ error: posterError.message }, { status: 500 });
    }
    poster = { path: posterSigned.path, token: posterSigned.token };
  }

  return NextResponse.json({
    video: { path: videoSigned.path, token: videoSigned.token },
    poster,
  });
}
