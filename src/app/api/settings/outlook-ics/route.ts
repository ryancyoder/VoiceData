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

  if (!raw) {
    await setSetting(OUTLOOK_ICS_KEY, null);
    return NextResponse.json({ url: null });
  }

  // Outlook's "Publish calendar" page shows BOTH an HTML link and an ICS link,
  // and people often paste both. Pull out the URL tokens and prefer the .ics
  // feed (the HTML one isn't a parseable calendar).
  const urls = raw.split(/\s+/).filter((t) => /^(https?|webcal):\/\//i.test(t));
  const chosen =
    urls.find((u) => /\.ics(\?|#|$)/i.test(u)) ?? urls.find((u) => /\.ics/i.test(u)) ?? urls[0] ?? "";
  if (!chosen) {
    return NextResponse.json({ error: "Couldn't find a valid https:// or webcal:// link" }, { status: 400 });
  }
  // Outlook sometimes hands out a webcal:// link — same feed, fetch over https.
  const normalized = chosen.replace(/^webcal:\/\//i, "https://");
  await setSetting(OUTLOOK_ICS_KEY, normalized);
  return NextResponse.json({ url: normalized });
}
