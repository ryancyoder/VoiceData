import { supabase } from "@/lib/supabaseClient";
import type { Deal, DealPhoto } from "@/lib/salesBoard";
import CalendarClient, { type CalendarEvent, type DealOption, type PropertyOption } from "./CalendarClient";

export const dynamic = "force-dynamic";

type RawPhoto = DealPhoto & {
  deal: Pick<Deal, "deal_name" | "company" | "stage" | "jobsite_address"> | null;
};

type RawEvent = {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  property_id: number | null;
  latitude: number | null;
  longitude: number | null;
  deal_photos: RawPhoto[];
};

export default async function CalendarPage() {
  const [eventsRes, dealsRes, propertiesRes, ungroupedRes] = await Promise.all([
    supabase
      .from("events")
      .select('*, deal_photos(*, deal:"Sales Board"(deal_name, company, stage, jobsite_address))')
      .order("start_time", { ascending: true }),
    supabase
      .from("Sales Board")
      .select("id, deal_name, company, stage, lost_at")
      .order("deal_name", { ascending: true }),
    supabase.from("properties").select("id, address").order("address", { ascending: true }),
    supabase.from("deal_photos").select("id", { count: "exact", head: true }).is("event_id", null),
  ]);

  if (eventsRes.error) {
    throw new Error(`Failed to load calendar: ${eventsRes.error.message}`);
  }
  if (dealsRes.error) {
    throw new Error(`Failed to load calendar: ${dealsRes.error.message}`);
  }
  if (propertiesRes.error) {
    throw new Error(`Failed to load calendar: ${propertiesRes.error.message}`);
  }

  const rawEvents = (eventsRes.data ?? []) as unknown as RawEvent[];
  const dealOptions = (dealsRes.data ?? []) as DealOption[];
  const propertyOptions = (propertiesRes.data ?? []) as PropertyOption[];
  const ungeotaggedCount = ungroupedRes.count ?? 0;

  const calendarEvents: CalendarEvent[] = rawEvents.map((event) => {
    const photos = event.deal_photos ?? [];
    const dealsById = new Map<number, RawPhoto["deal"]>();
    for (const p of photos) {
      if (p.deal && !dealsById.has(p.deal_id)) dealsById.set(p.deal_id, p.deal);
    }
    const dealIds = Array.from(new Set(photos.map((p) => p.deal_id)));

    return {
      id: event.id,
      name: event.name,
      start: event.start_time,
      end: event.end_time,
      propertyId: event.property_id,
      latitude: event.latitude,
      longitude: event.longitude,
      dealIds,
      photos: photos.map((p) => ({
        id: p.id,
        deal_id: p.deal_id,
        storage_path: p.storage_path,
        caption: p.caption,
        created_at: p.created_at,
        taken_at: p.taken_at,
        latitude: p.latitude,
        longitude: p.longitude,
        event_id: p.event_id,
        media_type: p.media_type,
        poster_path: p.poster_path,
      })),
      deals: dealIds.map((id) => {
        const d = dealsById.get(id);
        return {
          id,
          name: d?.deal_name ?? `Deal #${id}`,
          company: d?.company ?? null,
          jobsiteAddress: d?.jobsite_address ?? null,
        };
      }),
    };
  });

  return (
    <CalendarClient
      events={calendarEvents}
      ungeotaggedCount={ungeotaggedCount}
      dealOptions={dealOptions}
      propertyOptions={propertyOptions}
    />
  );
}
