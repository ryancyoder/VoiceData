import { NextRequest, NextResponse } from "next/server";
import {
  getSetting,
  setSetting,
  getNumberSetting,
  setNumberSetting,
  OUTLOOK_ICS_KEY,
  OUTLOOK_OPACITY_KEY,
  OUTLOOK_OPACITY_DEFAULT,
  OUTLOOK_OPACITY_MIN,
  OUTLOOK_OPACITY_MAX,
} from "@/lib/appSettings";

export const dynamic = "force-dynamic";

async function readSettings() {
  const [url, opacity] = await Promise.all([
    getSetting(OUTLOOK_ICS_KEY),
    getNumberSetting(OUTLOOK_OPACITY_KEY, OUTLOOK_OPACITY_DEFAULT, OUTLOOK_OPACITY_MIN, OUTLOOK_OPACITY_MAX),
  ]);
  return { url, opacity };
}

// Read/save the Outlook overlay's settings: the published .ics feed URL and how
// strongly the overlay is drawn on the Calendar.
export async function GET() {
  return NextResponse.json(await readSettings());
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown; opacity?: unknown };

  // Each field is optional so the opacity slider can save without restating the
  // feed URL. Note the asymmetry with "url" below: an EMPTY url is a real
  // instruction ("clear the feed"), so only an ABSENT url means "leave alone".
  if ("opacity" in body) {
    const value = Number(body.opacity);
    if (!Number.isFinite(value)) {
      return NextResponse.json({ error: "opacity must be a number" }, { status: 400 });
    }
    const { error } = await setNumberSetting(OUTLOOK_OPACITY_KEY, value, OUTLOOK_OPACITY_MIN, OUTLOOK_OPACITY_MAX);
    if (error) return NextResponse.json({ error: `Couldn't save: ${error}` }, { status: 500 });
  }

  if ("url" in body) {
    const raw = typeof body.url === "string" ? body.url.trim() : "";

    if (!raw) {
      const { error } = await setSetting(OUTLOOK_ICS_KEY, null);
      if (error) return NextResponse.json({ error: `Couldn't save: ${error}` }, { status: 500 });
      return NextResponse.json(await readSettings());
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
    const { error } = await setSetting(OUTLOOK_ICS_KEY, normalized);
    if (error) return NextResponse.json({ error: `Couldn't save: ${error}` }, { status: 500 });
  }

  return NextResponse.json(await readSettings());
}
