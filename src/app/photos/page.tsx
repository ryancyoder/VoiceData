import { supabase } from "@/lib/supabaseClient";
import { SITE_PLAN_IMAGE_TYPE, PROPERTY_REFERENCE_TYPE, ACTION_PHOTO_TYPE, type DealPhoto } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
import PhotoGalleryClient, { type GalleryEvent } from "./PhotoGalleryClient";
import { refEventId } from "./refEventId";

export const dynamic = "force-dynamic";

// deal_photos now carries foreign keys to events, "Sales Board", AND
// properties, so PostgREST treats it as a junction table between every pair of
// those. Any embed that hops across those tables became ambiguous (reachable
// both directly and through the deal_photos junction) and made the whole page
// throw. To stay immune to that entirely, this page fetches each table with a
// PLAIN query (no cross-table embeds except the single-FK ones that can never
// be ambiguous) and joins them together in code by id.

type PropRow = {
  id: number;
  address: string;
  cover_photo_id: number | null;
  next_action_photo_id: number | null;
  contacts: { last_name: string | null } | null;
};

type DealRow = {
  id: number;
  deal_name: string;
  company: string | null;
  stage: string | null;
  lost_at: string | null;
  property_id: number | null;
  next_action_photo_id: number | null;
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
};

// Fetch properties (with their contact's last name) by id into a lookup map.
// properties<->contacts is a single-FK relationship with no junction table, so
// that one embed is always safe.
async function fetchProperties(ids: number[]): Promise<Map<number, PropRow>> {
  const map = new Map<number, PropRow>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data, error } = await supabase
    .from("properties")
    .select("id, address, cover_photo_id, next_action_photo_id, contacts(last_name)")
    .in("id", unique);
  if (error) throw new Error(`load properties: ${error.message}`);
  for (const p of (data ?? []) as unknown as PropRow[]) map.set(p.id, p);
  return map;
}

async function fetchDeals(ids: number[]): Promise<Map<number, DealRow>> {
  const map = new Map<number, DealRow>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data, error } = await supabase
    .from("Sales Board")
    .select("id, deal_name, company, stage, lost_at, property_id, next_action_photo_id")
    .in("id", unique);
  if (error) throw new Error(`load deals: ${error.message}`);
  for (const d of (data ?? []) as unknown as DealRow[]) map.set(d.id, d);
  return map;
}

async function loadGallery(): Promise<GalleryEvent[]> {
  // 1) Events with their photos. deal_photos<->events is a single FK (no
  //    junction), so this embed is unambiguous and safe.
  const { data: eventData, error: eventError } = await supabase
    .from("events")
    .select("id, name, start_time, end_time, event_type, property_id, deal_id, deal_photos(*)")
    .order("start_time", { ascending: true });
  if (eventError) throw new Error(`load events: ${eventError.message}`);
  const rawEvents = (eventData ?? []) as unknown as RawEvent[];

  // 2) Site-plan photos (event-less deal photos), plain — grouped by deal below.
  const { data: sitePlanData, error: sitePlanError } = await supabase
    .from("deal_photos")
    .select("*")
    .eq("photo_type", SITE_PLAN_IMAGE_TYPE)
    .order("created_at", { ascending: false });
  if (sitePlanError) throw new Error(`load site plans: ${sitePlanError.message}`);
  const sitePlanPhotos = (sitePlanData ?? []) as DealPhoto[];

  // 3) General-reference photos (event-less, deal-less property photos), plain.
  const { data: refData, error: refError } = await supabase
    .from("deal_photos")
    .select("*")
    .eq("photo_type", PROPERTY_REFERENCE_TYPE)
    .order("created_at", { ascending: false });
  if (refError) throw new Error(`load reference photos: ${refError.message}`);
  const refPhotos = (refData ?? []) as DealPhoto[];

  // 4) Action photos (event-less deal photos uploaded from the Next Actions
  //    list), plain — grouped by deal below into an "Action" section.
  const { data: actionData, error: actionError } = await supabase
    .from("deal_photos")
    .select("*")
    .eq("photo_type", ACTION_PHOTO_TYPE)
    .order("created_at", { ascending: false });
  if (actionError) throw new Error(`load action photos: ${actionError.message}`);
  const actionPhotos = (actionData ?? []) as DealPhoto[];

  // Resolve every deal and property referenced above in two batched lookups.
  const dealIds = [
    ...rawEvents.map((e) => e.deal_id),
    ...sitePlanPhotos.map((p) => p.deal_id),
    ...actionPhotos.map((p) => p.deal_id),
  ].filter((id): id is number => id != null);
  const deals = await fetchDeals(dealIds);

  const propertyIds = [
    ...rawEvents.map((e) => e.property_id),
    ...Array.from(deals.values()).map((d) => d.property_id),
    ...refPhotos.map((p) => p.property_id),
  ].filter((id): id is number => id != null);
  const props = await fetchProperties(propertyIds);

  // --- Real events -----------------------------------------------------------
  const events: GalleryEvent[] = rawEvents
    .filter((e) => (e.deal_photos ?? []).length > 0)
    .map((e) => {
      const deal = e.deal_id != null ? deals.get(e.deal_id) ?? null : null;
      const prop = e.property_id != null ? props.get(e.property_id) ?? null : null;
      return {
        id: e.id,
        name: e.name,
        start_time: e.start_time,
        end_time: e.end_time,
        event_type: e.event_type,
        photos: e.deal_photos ?? [],
        dealId: e.deal_id,
        dealName: deal?.deal_name ?? null,
        dealCompany: deal?.company ?? null,
        dealStage: deal?.stage ?? null,
        propertyId: e.property_id,
        propertyAddress: prop?.address ?? null,
        propertyContactLastName: prop?.contacts?.last_name ?? null,
        propertyCoverPhotoId: prop?.cover_photo_id ?? null,
        dealNextActionPhotoId: deal?.next_action_photo_id ?? null,
      };
    });

  // --- Site plans (one synthetic group per deal) -----------------------------
  const sitePlansByDeal = new Map<number, DealPhoto[]>();
  for (const photo of sitePlanPhotos) {
    if (photo.deal_id == null || !deals.has(photo.deal_id)) continue;
    const list = sitePlansByDeal.get(photo.deal_id) ?? [];
    list.push(photo);
    sitePlansByDeal.set(photo.deal_id, list);
  }
  const sitePlanEvents: GalleryEvent[] = Array.from(sitePlansByDeal.entries()).map(([dealId, rows]) => {
    const deal = deals.get(dealId)!;
    const prop = deal.property_id != null ? props.get(deal.property_id) ?? null : null;
    return {
      id: -dealId, // synthetic, negative so it never collides with a real event id
      name: "Site Plan",
      start_time: rows[0].created_at,
      end_time: rows[0].created_at,
      event_type: null,
      isSitePlan: true,
      photos: rows,
      dealId,
      dealName: deal.deal_name,
      dealCompany: deal.company,
      dealStage: deal.stage,
      propertyId: deal.property_id,
      propertyAddress: prop?.address ?? null,
      propertyContactLastName: prop?.contacts?.last_name ?? null,
      propertyCoverPhotoId: prop?.cover_photo_id ?? null,
      dealNextActionPhotoId: deal.next_action_photo_id ?? null,
    };
  });

  // --- Action photos (one synthetic "Action" group per deal) -----------------
  const actionByDeal = new Map<number, DealPhoto[]>();
  for (const photo of actionPhotos) {
    if (photo.deal_id == null || !deals.has(photo.deal_id)) continue;
    const list = actionByDeal.get(photo.deal_id) ?? [];
    list.push(photo);
    actionByDeal.set(photo.deal_id, list);
  }
  const actionEvents: GalleryEvent[] = Array.from(actionByDeal.entries()).map(([dealId, rows]) => {
    const deal = deals.get(dealId)!;
    const prop = deal.property_id != null ? props.get(deal.property_id) ?? null : null;
    return {
      id: -1_000_000 - dealId, // synthetic, offset so it never collides with a site-plan or real event id
      name: "Next action",
      start_time: rows[0].created_at,
      end_time: rows[0].created_at,
      event_type: null,
      isActionSection: true,
      photos: rows,
      dealId,
      dealName: deal.deal_name,
      dealCompany: deal.company,
      dealStage: deal.stage,
      propertyId: deal.property_id,
      propertyAddress: prop?.address ?? null,
      propertyContactLastName: prop?.contacts?.last_name ?? null,
      propertyCoverPhotoId: prop?.cover_photo_id ?? null,
      dealNextActionPhotoId: deal.next_action_photo_id ?? null,
    };
  });

  // --- General reference (one synthetic group per property) ------------------
  const refByProperty = new Map<number, DealPhoto[]>();
  for (const photo of refPhotos) {
    if (photo.property_id == null || !props.has(photo.property_id)) continue;
    const list = refByProperty.get(photo.property_id) ?? [];
    list.push(photo);
    refByProperty.set(photo.property_id, list);
  }
  const referenceEvents: GalleryEvent[] = Array.from(refByProperty.entries()).map(([propertyId, rows]) => {
    const prop = props.get(propertyId)!;
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
      dealNextActionPhotoId: null, // general-reference photos aren't tied to a deal
    };
  });

  // Append synthetic groups after real events so a jobsite photo stays the
  // default album cover.
  return [...events, ...sitePlanEvents, ...actionEvents, ...referenceEvents];
}

export default async function PhotosPage() {
  let gallery: GalleryEvent[];
  try {
    gallery = await loadGallery();
  } catch (err) {
    // Surface the real message instead of Next's generic error digest, so the
    // exact failing query is visible on the page.
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: 8 }}>Photos failed to load</h1>
        <p style={{ color: "#71717a", fontSize: "0.9rem", marginBottom: 12 }}>
          The gallery data query returned an error. Details:
        </p>
        <pre
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            padding: 14,
            borderRadius: 10,
            fontSize: "0.85rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message}
        </pre>
      </div>
    );
  }

  return <PhotoGalleryClient events={gallery} />;
}
