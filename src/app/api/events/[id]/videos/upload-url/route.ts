import { NextRequest, NextResponse } from "next/server";
import { createVideoSignedUploadUrls } from "@/lib/videoUploadUrls";

type RouteParams = { params: Promise<{ id: string }> };

// A video's base-level attachment is to an event, not a deal — this route
// (unlike the deal-scoped one) needs no deal_id at all. Same signed-URL
// pattern: the browser uploads straight to Storage, bypassing our server.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as { videoFileName?: unknown; hasPoster?: unknown };

  const videoFileName = typeof body.videoFileName === "string" ? body.videoFileName : "";
  if (!videoFileName) {
    return NextResponse.json({ error: "videoFileName is required" }, { status: 400 });
  }

  try {
    const urls = await createVideoSignedUploadUrls(`event-${id}`, videoFileName, !!body.hasPoster);
    return NextResponse.json(urls);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare video upload" },
      { status: 500 }
    );
  }
}
