import { supabase } from "@/lib/supabaseClient";
import type { DealPhoto } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
import PhotoGalleryClient, { type GalleryEvent } from "./PhotoGalleryClient";

export const dynamic = "force-dynamic";

type RawEvent = {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  event_type: EventType | null;
  property_id: number | null;
  deal_id: number | null;
  deal_photos: DealPhoto[] | null;
  deal: { id: number; deal_name: string; company: string | null; stage: string; lost_at: string | null } | null;
  properties: { id: number; address: string; contacts: { last_name: string | null } | null } | null;
};

export default async function PhotosPage() {
  // Photos are reached only by way of their event, and an event's deal and
  // property are each independent (an event may have neither, either, or
  // both) — querying events directly, rather than starting from deals,
  // is the only way to see every photographed event regardless of whether
  // it's been attached to a deal yet.
  const { data, error } = await supabase
    .from("events")
    .select(
      'id, name, start_time, end_time, event_type, property_id, deal_id, deal_photos(*), deal:"Sales Board"(id, deal_name, company, stage, lost_at), properties(id, address, contacts(last_name))'
    )
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Failed to load photos: ${error.message}`);
  }

  const rawEvents = (data ?? []) as unknown as RawEvent[];

  const events: GalleryEvent[] = rawEvents
    .filter((e) => (e.deal_photos ?? []).length > 0)
    .map((e) => ({
      id: e.id,
      name: e.name,
      start_time: e.start_time,
      end_time: e.end_time,
      event_type: e.event_type,
      photos: e.deal_photos ?? [],
      dealId: e.deal_id,
      dealName: e.deal?.deal_name ?? null,
      dealCompany: e.deal?.company ?? null,
      dealStage: e.deal?.stage ?? null,
      propertyId: e.property_id,
      propertyAddress: e.properties?.address ?? null,
      propertyContactLastName: e.properties?.contacts?.last_name ?? null,
    }));

  return <PhotoGalleryClient events={events} />;
}
