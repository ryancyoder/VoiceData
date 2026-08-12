import { supabase } from "@/lib/supabaseClient";
import { SITE_PLAN_IMAGE_TYPE, PROPERTY_REFERENCE_TYPE, type DealPhoto } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
import PhotoGalleryClient, { type GalleryEvent, refEventId } from "./PhotoGalleryClient";

export const dynamic = "force-dynamic";

// A deal's event-less site plan photos, joined to their deal + property so
// they can be slotted into the album's property→deal grouping.
type RawSitePlan = DealPhoto & {
  deal:
    | {
        id: number;
        deal_name: string;
        company: string | null;
        stage: string | null;
        property_id: number | null;
        properties: { id: number; address: string; cover_photo_id: number | null; contacts: { last_name: string | null } | null } | null;
      }
    | null;
};

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
  properties: { id: number; address: string; cover_photo_id: number | null; contacts: { last_name: string | null } | null } | null;
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
      // deal_photos has FKs to events, "Sales Board", AND properties, so
      // PostgREST now sees it as a junction table between every pair of them.
      // That makes both the "Sales Board" and properties embeds below ambiguous
      // (each is reachable directly AND via the deal_photos junction), so we pin
      // each to its direct foreign-key column with a `!<column>` hint.
      'id, name, start_time, end_time, event_type, property_id, deal_id, deal_photos(*), deal:"Sales Board"!deal_id(id, deal_name, company, stage, lost_at), properties!property_id(id, address, cover_photo_id, contacts(last_name))'
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
      propertyCoverPhotoId: e.properties?.cover_photo_id ?? null,
    }));

  // Site plan images are event-less deal photos, so they don't come through the
  // events query above. Fetch them separately and slot one synthetic "Site
  // Plan" group per deal into the same property→deal album structure.
  const { data: sitePlanData, error: sitePlanError } = await supabase
    .from("deal_photos")
    .select(
      // properties is reachable from "Sales Board" both directly and via the
      // deal_photos junction, so pin it to the direct FK column (see the events
      // query above for the full explanation).
      '*, deal:"Sales Board"(id, deal_name, company, stage, property_id, properties!property_id(id, address, cover_photo_id, contacts(last_name)))'
    )
    .eq("photo_type", SITE_PLAN_IMAGE_TYPE)
    .order("created_at", { ascending: false });

  if (sitePlanError) {
    throw new Error(`Failed to load site plan photos: ${sitePlanError.message}`);
  }

  const sitePlansByDeal = new Map<number, RawSitePlan[]>();
  for (const row of (sitePlanData ?? []) as unknown as RawSitePlan[]) {
    if (!row.deal) continue;
    const list = sitePlansByDeal.get(row.deal.id) ?? [];
    list.push(row);
    sitePlansByDeal.set(row.deal.id, list);
  }

  const sitePlanEvents: GalleryEvent[] = Array.from(sitePlansByDeal.entries()).map(([dealId, rows]) => {
    const deal = rows[0].deal!;
    return {
      id: -dealId, // synthetic, negative so it never collides with a real event id
      name: "Site Plan",
      start_time: rows[0].created_at,
      end_time: rows[0].created_at,
      event_type: null,
      isSitePlan: true,
      photos: rows.map(({ deal: _deal, ...photo }) => photo as DealPhoto),
      dealId,
      dealName: deal.deal_name,
      dealCompany: deal.company,
      dealStage: deal.stage,
      propertyId: deal.property_id,
      propertyAddress: deal.properties?.address ?? null,
      propertyContactLastName: deal.properties?.contacts?.last_name ?? null,
      propertyCoverPhotoId: deal.properties?.cover_photo_id ?? null,
    };
  });

  // General-reference photos are event-less (and deal-less) property photos, so
  // they don't come through either query above. Fetched as two plain queries
  // (photos, then their properties) and joined in code — deliberately NOT via a
  // PostgREST embed, because deal_photos now links to properties two ways
  // (property_id and the reverse properties.cover_photo_id), which makes an
  // embed ambiguous/fragile. Two simple queries sidestep that entirely.
  const { data: refData, error: refError } = await supabase
    .from("deal_photos")
    .select("*")
    .eq("photo_type", PROPERTY_REFERENCE_TYPE)
    .order("created_at", { ascending: false });

  if (refError) {
    throw new Error(`Failed to load reference photos: ${refError.message}`);
  }

  const refPhotos = (refData ?? []) as DealPhoto[];
  const refPropertyIds = [...new Set(refPhotos.map((p) => p.property_id).filter((id): id is number => id != null))];

  const refProps = new Map<number, { id: number; address: string; cover_photo_id: number | null; contacts: { last_name: string | null } | null }>();
  if (refPropertyIds.length > 0) {
    const { data: propData, error: propError } = await supabase
      .from("properties")
      .select("id, address, cover_photo_id, contacts(last_name)")
      .in("id", refPropertyIds);
    if (propError) {
      throw new Error(`Failed to load reference photo properties: ${propError.message}`);
    }
    for (const p of (propData ?? []) as unknown as { id: number; address: string; cover_photo_id: number | null; contacts: { last_name: string | null } | null }[]) {
      refProps.set(p.id, p);
    }
  }

  const refByProperty = new Map<number, DealPhoto[]>();
  for (const photo of refPhotos) {
    if (photo.property_id == null || !refProps.has(photo.property_id)) continue;
    const list = refByProperty.get(photo.property_id) ?? [];
    list.push(photo);
    refByProperty.set(photo.property_id, list);
  }

  const referenceEvents: GalleryEvent[] = Array.from(refByProperty.entries()).map(([propertyId, rows]) => {
    const prop = refProps.get(propertyId)!;
    return {
      id: refEventId(propertyId),
      name: "General reference",
      start_time: rows[0].created_at,
      end_time: rows[0].created_at,
      event_type: null,
      isPropertyReference: true,
      photos: rows,
      dealId: null,
      dealName: null,
      dealCompany: null,
      dealStage: null,
      propertyId,
      propertyAddress: prop.address,
      propertyContactLastName: prop.contacts?.last_name ?? null,
      propertyCoverPhotoId: prop.cover_photo_id,
    };
  });

  // Append after real events so a jobsite photo stays the default album cover.
  return <PhotoGalleryClient events={[...events, ...sitePlanEvents, ...referenceEvents]} />;
}
