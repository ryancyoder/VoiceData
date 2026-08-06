import type { Contact, Deal, DealAttachment, DealPhoto, Property } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";

// Shared between every query that needs a deal's events+photos nested
// (Sales Board list, single-deal fetch) — a photo is reached only by way
// of its event, never directly off the deal. A deal's contact is likewise
// reached only by way of its property, never a direct deal column.
// Attachments (POs/receipts) are the one exception to "reached by way of
// an event" — they hang directly off the deal, so deal_attachments joins
// straight onto it rather than nesting under events.
export const DEAL_EVENTS_SELECT =
  "*, events(id, name, start_time, end_time, event_type, deal_photos(*)), properties(id, address, latitude, longitude, geocoded_at, primary_contact_id, created_at, contacts(id, first_name, last_name, email, phone, created_at)), deal_attachments(*)";

type RawEvent = {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  event_type: EventType | null;
  deal_photos: DealPhoto[] | null;
};

type RawProperty = Omit<Property, "contact"> & { contacts: Contact | null };

type RawDeal = Omit<Deal, "events" | "property" | "attachments"> & {
  events: RawEvent[] | null;
  properties: RawProperty | null;
  deal_attachments: DealAttachment[] | null;
};

// nextActionTitleByDeal maps deal id -> the title of whichever task is
// flagged as that deal's next action (see src/lib/tasks.ts) — a deal has
// no next_action column of its own to select, so this is the only way to
// populate Deal.next_action. Omitted entirely (rather than defaulted to
// an empty map inline) still works: every deal just gets null.
export function mapRawDealEvents(rawDeals: unknown[], nextActionTitleByDeal?: Map<number, string>): Deal[] {
  return (rawDeals as RawDeal[]).map((d) => {
    const { properties, events, deal_attachments, ...rest } = d;
    return {
      ...rest,
      next_action: nextActionTitleByDeal?.get(d.id) ?? null,
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
      attachments: (deal_attachments ?? []).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    };
  });
}
