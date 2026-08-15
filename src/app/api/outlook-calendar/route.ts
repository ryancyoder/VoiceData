import { NextRequest, NextResponse } from "next/server";
import IcalExpander from "ical-expander";
import { getSetting, OUTLOOK_ICS_KEY } from "@/lib/appSettings";

export const dynamic = "force-dynamic";

// Read-only overlay feed: fetch the user's published Outlook .ics, expand it
// (including recurring meetings) for the requested window, and return plain
// events. Never fetched by the browser — the feed URL is a secret, so it stays
// server-side. The upstream feed lags (Outlook regenerates it periodically), so
// the fetch is cached briefly rather than hit on every calendar navigation.
export async function GET(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const feedUrl = await getSetting(OUTLOOK_ICS_KEY);
  if (!feedUrl) {
    return NextResponse.json(debug ? { configured: false, note: "No feed URL saved in Settings." } : { configured: false, events: [] });
  }

  const startParam = req.nextUrl.searchParams.get("start");
  const endParam = req.nextUrl.searchParams.get("end");
  const start = startParam ? new Date(startParam) : new Date();
  const end = endParam ? new Date(endParam) : new Date(start.getTime() + 21 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid start/end" }, { status: 400 });
  }

  // Host only (never leak the secret path/token), so debug output is shareable.
  let feedHost: string | null = null;
  try {
    feedHost = new URL(feedUrl).host;
  } catch {
    /* ignore */
  }

  let ics: string;
  try {
    const res = await fetch(feedUrl, { next: { revalidate: debug ? 0 : 600 } });
    if (!res.ok) {
      return NextResponse.json({ configured: true, error: `Feed returned HTTP ${res.status}`, feedHost, events: [] });
    }
    ics = await res.text();
  } catch {
    return NextResponse.json({ configured: true, error: "Could not reach the calendar feed", feedHost, events: [] });
  }

  if (debug) {
    const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
    return NextResponse.json({
      configured: true,
      feedHost,
      fetchedBytes: ics.length,
      looksLikeIcs: ics.includes("BEGIN:VCALENDAR"),
      totalVEVENTs: veventCount,
      window: { start: start.toISOString(), end: end.toISOString() },
      firstChars: ics.slice(0, 200),
    });
  }

  let expanded;
  try {
    const expander = new IcalExpander({ ics, maxIterations: 2000, skipInvalidDates: true });
    expanded = expander.between(start, end);
  } catch {
    return NextResponse.json({ configured: true, error: "Could not parse the calendar feed", feedHost, events: [] });
  }

  type Occ = {
    startDate: { toJSDate(): Date; isDate: boolean };
    endDate: { toJSDate(): Date };
    title: string;
    location: string | null;
    description: string | null;
    uid: string;
  };
  const rows: Occ[] = [
    ...expanded.events.map((e) => ({
      startDate: e.startDate,
      endDate: e.endDate,
      title: e.summary || "(busy)",
      location: e.location || null,
      description: e.description || null,
      uid: e.uid,
    })),
    ...expanded.occurrences.map((o) => ({
      startDate: o.startDate,
      endDate: o.endDate,
      title: o.item.summary || "(busy)",
      location: o.item.location || null,
      description: o.item.description || null,
      uid: o.item.uid,
    })),
  ];

  const events = rows.map((r) => {
    const startJs = r.startDate.toJSDate();
    return {
      id: `${r.uid}-${startJs.getTime()}`,
      title: r.title,
      start: startJs.toISOString(),
      end: r.endDate.toJSDate().toISOString(),
      allDay: r.startDate.isDate,
      location: r.location,
      description: r.description,
    };
  });

  return NextResponse.json({ configured: true, events });
}
