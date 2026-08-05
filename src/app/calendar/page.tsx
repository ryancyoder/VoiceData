import { supabase } from "@/lib/supabaseClient";
import type { Deal, DealPhoto } from "@/lib/salesBoard";
import { buildPhotoEvents } from "@/lib/photoEvents";
import CalendarClient, { type CalendarEvent } from "./CalendarClient";

export const dynamic = "force-dynamic";

type RawPhoto = DealPhoto & {
  deal: Pick<Deal, "deal_name" | "company" | "stage" | "jobsite_address"> | null;
};

export default async function CalendarPage() {
  const { data, error } = await supabase
    .from("deal_photos")
    .select('*, deal:"Sales Board"(deal_name, company, stage, jobsite_address)')
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load calendar: ${error.message}`);
  }

  const photos = (data ?? []) as unknown as RawPhoto[];
  const dealsById = new Map<number, RawPhoto["deal"]>();
  for (const p of photos) {
    if (p.deal && !dealsById.has(p.deal_id)) dealsById.set(p.deal_id, p.deal);
  }

  const events = buildPhotoEvents(photos);
  const calendarEvents: CalendarEvent[] = events.map((e) => ({
    ...e,
    deals: e.dealIds.map((id) => {
      const d = dealsById.get(id);
      return {
        id,
        name: d?.deal_name ?? `Deal #${id}`,
        company: d?.company ?? null,
        jobsiteAddress: d?.jobsite_address ?? null,
      };
    }),
  }));

  const geotaggedCount = photos.filter((p) => p.latitude != null && p.longitude != null).length;
  const ungeotaggedCount = photos.length - geotaggedCount;

  return <CalendarClient events={calendarEvents} ungeotaggedCount={ungeotaggedCount} />;
}
