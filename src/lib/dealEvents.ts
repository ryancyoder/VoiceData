import type { Contact, Deal, DealPhoto, Property } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";

// Shared between every query that needs a deal's events+photos nested
// (Sales Board list, single-deal fetch) — a photo is reached only by way
// of its event, never directly off the deal. A deal's contact is likewise
// reached only by way of its property, never a direct deal column.
export const DEAL_EVENTS_SELECT =
  "*, events(id, name, start_time, end_time, event_type, deal_photos(*)), properties(id, address, latitude, longitude, geocoded_at, primary_contact_id, created_at, contacts(id, first_name, last_name, email, phone, created_at))";

type RawEvent = {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  event_type: EventType | null;
  deal_photos: DealPhoto[] | null;
};

type RawProperty = Omit<Property, "contact"> & { contacts: Contact | null };

type RawDeal = Omit<Deal, "events" | "property"> & { events: RawEvent[] | null; properties: RawProperty | null };

export function mapRawDealEvents(rawDeals: unknown[]): Deal[] {
  return (rawDeals as RawDeal[]).map((d) => {
    const { properties, events, ...rest } = d;
    return {
      ...rest,
      property: properties ? { ...properties, contact: properties.contacts ?? null } : null,
      events: (events ?? [])
        .map((e) => ({
          id: e.id,
          name: e.name,
          start_time: e.start_time,
          end_time: e.end_time,
          event_type: e.event_type,
          photos: e.deal_photos ?? [],
        }))
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
    };
  });
}
