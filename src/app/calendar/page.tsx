import { supabase } from "@/lib/supabaseClient";
import type { Deal, DealPhoto } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
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
  deal_id: number | null;
  event_type: EventType | null;
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
    supabase
      .from("properties")
      .select("id, address, contacts(last_name)")
      .order("address", { ascending: true }),
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
  const rawProperties = (propertiesRes.data ?? []) as unknown as {
    id: number;
    address: string;
    contacts: { last_name: string | null } | null;
  }[];
  const propertyOptions: PropertyOption[] = rawProperties.map((p) => ({
    id: p.id,
    address: p.address,
    contactLastName: p.contacts?.last_name ?? null,
  }));
  const ungeotaggedCount = ungroupedRes.count ?? 0;
  const dealOptionsById = new Map(dealOptions.map((d) => [d.id, d]));

  const calendarEvents: CalendarEvent[] = rawEvents.map((event) => {
    const photos = event.deal_photos ?? [];
    const dealsById = new Map<number, RawPhoto["deal"]>();
    for (const p of photos) {
      if (p.deal_id != null && p.deal && !dealsById.has(p.deal_id)) dealsById.set(p.deal_id, p.deal);
    }
    // A video attached only to the event (no deal_id of its own) doesn't
    // contribute a deal here — but the event's own deal_id (set directly,
    // separate from any individual photo's deal_id) still should.
    const dealIdSet = new Set<number>();
    for (const p of photos) if (p.deal_id != null) dealIdSet.add(p.deal_id);
    if (event.deal_id != null) dealIdSet.add(event.deal_id);
    const dealIds = Array.from(dealIdSet);

    return {
      id: event.id,
      name: event.name,
      start: event.start_time,
      end: event.end_time,
      propertyId: event.property_id,
      dealId: event.deal_id,
      eventType: event.event_type,
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
        const fromPhoto = dealsById.get(id);
        const fromOption = dealOptionsById.get(id);
        return {
          id,
          name: fromPhoto?.deal_name ?? fromOption?.deal_name ?? `Deal #${id}`,
          company: fromPhoto?.company ?? fromOption?.company ?? null,
          jobsiteAddress: fromPhoto?.jobsite_address ?? null,
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
