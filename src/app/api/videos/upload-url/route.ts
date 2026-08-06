import { NextRequest, NextResponse } from "next/server";
import { createVideoSignedUploadUrls } from "@/lib/videoUploadUrls";

// Same signed-URL pattern as the deal-scoped and event-scoped video routes,
// but with no deal or event known yet at request time — used by the general
// import flow, where the property (or "no location") isn't resolved to an
// event until the finalize call below.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { videoFileName?: unknown; hasPoster?: unknown };

  const videoFileName = typeof body.videoFileName === "string" ? body.videoFileName : "";
  if (!videoFileName) {
    return NextResponse.json({ error: "videoFileName is required" }, { status: 400 });
  }

  try {
    const urls = await createVideoSignedUploadUrls("import", videoFileName, !!body.hasPoster);
    return NextResponse.json(urls);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare video upload" },
      { status: 500 }
    );
  }
}
