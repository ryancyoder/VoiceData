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
  const feedUrl = await getSetting(OUTLOOK_ICS_KEY);
  if (!feedUrl) return NextResponse.json({ configured: false, events: [] });

  const startParam = req.nextUrl.searchParams.get("start");
  const endParam = req.nextUrl.searchParams.get("end");
  const start = startParam ? new Date(startParam) : new Date();
  const end = endParam ? new Date(endParam) : new Date(start.getTime() + 21 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid start/end" }, { status: 400 });
  }

  let ics: string;
  try {
    const res = await fetch(feedUrl, { next: { revalidate: 600 } });
    if (!res.ok) {
      return NextResponse.json({ configured: true, error: `Feed returned HTTP ${res.status}`, events: [] });
    }
    ics = await res.text();
  } catch {
    return NextResponse.json({ configured: true, error: "Could not reach the calendar feed", events: [] });
  }

  let expanded;
  try {
    const expander = new IcalExpander({ ics, maxIterations: 2000, skipInvalidDates: true });
    expanded = expander.between(start, end);
  } catch {
    return NextResponse.json({ configured: true, error: "Could not parse the calendar feed", events: [] });
  }

  type Occ = { startDate: { toJSDate(): Date; isDate: boolean }; endDate: { toJSDate(): Date }; title: string; location: string | null; uid: string };
  const rows: Occ[] = [
    ...expanded.events.map((e) => ({
      startDate: e.startDate,
      endDate: e.endDate,
      title: e.summary || "(busy)",
      location: e.location || null,
      uid: e.uid,
    })),
    ...expanded.occurrences.map((o) => ({
      startDate: o.startDate,
      endDate: o.endDate,
      title: o.item.summary || "(busy)",
      location: o.item.location || null,
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
    };
  });

  return NextResponse.json({ configured: true, events });
}
