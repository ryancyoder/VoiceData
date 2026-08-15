import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting, OUTLOOK_ICS_KEY } from "@/lib/appSettings";

export const dynamic = "force-dynamic";

// Read/save the published Outlook calendar .ics feed URL (a single app setting).
export async function GET() {
  return NextResponse.json({ url: await getSetting(OUTLOOK_ICS_KEY) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (raw && !/^(https?|webcal):\/\//i.test(raw)) {
    return NextResponse.json({ error: "Enter a valid https:// or webcal:// URL" }, { status: 400 });
  }
  // Outlook often hands out a webcal:// link — same feed, fetch it over https.
  const normalized = raw.replace(/^webcal:\/\//i, "https://");
  await setSetting(OUTLOOK_ICS_KEY, normalized || null);
  return NextResponse.json({ url: normalized || null });
}
