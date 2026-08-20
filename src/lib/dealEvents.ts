import type { Contact, Deal, DealAttachment, DealCorrespondence, DealPhoto, DealTranscript, Property } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";

// Shared between every query that needs a deal's events+photos nested
// (Sales Board list, single-deal fetch) — a photo is reached only by way
// of its event, never directly off the deal. A deal's contact is likewise
// reached only by way of its property, never a direct deal column.
// Attachments (POs/receipts) and correspondence screenshots are the
// exceptions to "reached by way of an event" — they hang directly off the
// deal, so deal_attachments/deal_correspondence join straight onto it
// rather than nesting under events.
export const DEAL_EVENTS_SELECT =
  "*, events(id, name, start_time, end_time, event_type, deal_photos(*)), properties(id, address, latitude, longitude, geocoded_at, primary_contact_id, created_at, contacts(id, first_name, last_name, email, phone, created_at)), deal_attachments(*), deal_correspondence(*), deal_transcripts(*)";

type RawEvent = {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  event_type: EventType | null;
  deal_photos: DealPhoto[] | null;
};

type RawProperty = Omit<Property, "contact"> & { contacts: Contact | null };

type RawDeal = Omit<Deal, "events" | "property" | "attachments" | "correspondence" | "transcripts"> & {
  events: RawEvent[] | null;
  properties: RawProperty | null;
  deal_attachments: DealAttachment[] | null;
  deal_correspondence: DealCorrespondence[] | null;
  deal_transcripts: DealTranscript[] | null;
};

// nextActionTitleByDeal maps deal id -> the title of whichever task is
// flagged as that deal's next action (see src/lib/tasks.ts) — a deal has
// no next_action column of its own to select, so this is the only way to
// populate Deal.next_action. Omitted entirely (rather than defaulted to
// an empty map inline) still works: every deal just gets null.
export function mapRawDealEvents(
  rawDeals: unknown[],
  nextActionTitleByDeal?: Map<number, string>,
  sitePlanPhotosByDeal?: Map<number, DealPhoto[]>
): Deal[] {
  return (rawDeals as RawDeal[]).map((d) => {
    const { properties, events, deal_attachments, deal_correspondence, deal_transcripts, ...rest } = d;
    return {
      ...rest,
      next_action: nextActionTitleByDeal?.get(d.id) ?? null,
      site_plan_photos: sitePlanPhotosByDeal?.get(d.id) ?? [],
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
      correspondence: (deal_correspondence ?? []).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
      // Newest appointment first — by when it happened (recorded_at) when known,
      // otherwise by when it was saved.
      transcripts: (deal_transcripts ?? []).sort(
        (a, b) =>
          new Date(b.recorded_at ?? b.created_at).getTime() -
          new Date(a.recorded_at ?? a.created_at).getTime()
      ),
    };
  });
}
