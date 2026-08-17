import { supabase } from "@/lib/supabaseClient";
import { dealThumbUrl, type Deal, type DealPhoto, type PropertyOption } from "@/lib/salesBoard";
import { mapRawDealEvents, DEAL_EVENTS_SELECT } from "@/lib/dealEvents";
import { getFlagSetting, SALES_BOARD_HOVER_PHOTO_KEY } from "@/lib/appSettings";
import SalesBoardClient from "./SalesBoardClient";

export const dynamic = "force-dynamic";

type RawProperty = {
  id: number;
  address: string;
  cover_photo_id: number | null;
  contacts: { last_name: string | null } | null;
};

/**
 * Maps property id -> displayable URL of that property's key photo (its album
 * cover), for the deal-card hover preview. Resolved here rather than on hover
 * so the preview paints immediately; only the image bytes load lazily.
 *
 * Cover ids are looked up in one batch query instead of per property. Photos
 * are keyed by their own id, not by property, because a cover is reached
 * through properties.cover_photo_id — deal_photos is a junction across
 * events/deals/properties, so embedding it risks PostgREST ambiguity (the same
 * reason /api/properties/[id]/cover uses two plain queries).
 */
async function loadPropertyCoverUrls(properties: RawProperty[]): Promise<Record<number, string>> {
  const coverIds = [...new Set(properties.map((p) => p.cover_photo_id).filter((id): id is number => id != null))];
  if (coverIds.length === 0) return {};

  const { data, error } = await supabase
    .from("deal_photos")
    .select("id, storage_path, poster_path, media_type")
    .in("id", coverIds);
  // A failed cover lookup costs the hover preview, not the board — fall back to
  // no previews rather than failing the whole page.
  if (error) return {};

  const photosById = new Map<number, Pick<DealPhoto, "media_type" | "storage_path" | "poster_path">>();
  for (const photo of data ?? []) photosById.set(photo.id, photo);

  const urls: Record<number, string> = {};
  for (const property of properties) {
    if (property.cover_photo_id == null) continue;
    const photo = photosById.get(property.cover_photo_id);
    // A cover pointing at a deleted photo, or a video whose poster capture
    // failed, has nothing renderable — leave those properties out entirely.
    const url = photo ? dealThumbUrl(photo) : null;
    if (url) urls[property.id] = url;
  }
  return urls;
}

export default async function SalesBoardPage() {
  const [dealsRes, propertiesRes, nextActionsRes, hoverPropertyPhoto] = await Promise.all([
    supabase.from("Sales Board").select(DEAL_EVENTS_SELECT).order("created_at", { ascending: true }),
    supabase
      .from("properties")
      .select("id, address, cover_photo_id, contacts(last_name)")
      .order("address", { ascending: true }),
    supabase.from("tasks").select("deal_id, title").eq("is_next_action", true),
    getFlagSetting(SALES_BOARD_HOVER_PHOTO_KEY),
  ]);

  if (dealsRes.error) {
    throw new Error(`Failed to load Sales Board: ${dealsRes.error.message}`);
  }
  if (propertiesRes.error) {
    throw new Error(`Failed to load Sales Board: ${propertiesRes.error.message}`);
  }
  if (nextActionsRes.error) {
    throw new Error(`Failed to load Sales Board: ${nextActionsRes.error.message}`);
  }

  const nextActionByDeal = new Map<number, string>();
  for (const row of (nextActionsRes.data ?? []) as { deal_id: number | null; title: string }[]) {
    if (row.deal_id != null) nextActionByDeal.set(row.deal_id, row.title);
  }

  const deals: Deal[] = mapRawDealEvents(dealsRes.data ?? [], nextActionByDeal);
  const rawProperties = (propertiesRes.data ?? []) as unknown as RawProperty[];
  const propertyOptions: PropertyOption[] = rawProperties.map((p) => ({
    id: p.id,
    address: p.address,
    contactLastName: p.contacts?.last_name ?? null,
  }));

  // Skipped entirely when the view option is off, so the board costs exactly
  // what it did before for anyone not using the preview.
  const propertyCoverUrls = hoverPropertyPhoto ? await loadPropertyCoverUrls(rawProperties) : {};

  return (
    <SalesBoardClient
      initialDeals={deals}
      initialPropertyOptions={propertyOptions}
      hoverPropertyPhoto={hoverPropertyPhoto}
      propertyCoverUrls={propertyCoverUrls}
    />
  );
}
