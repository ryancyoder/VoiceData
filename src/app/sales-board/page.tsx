import { supabase } from "@/lib/supabaseClient";
import { dealThumbUrl, type Deal, type DealPhoto, type PropertyOption } from "@/lib/salesBoard";
import { mapRawDealEvents, DEAL_EVENTS_SELECT } from "@/lib/dealEvents";
import {
  getFlagSetting,
  SALES_BOARD_HOVER_PHOTO_KEY,
  SALES_BOARD_HOVER_PHOTO_WIDE_KEY,
} from "@/lib/appSettings";
import SalesBoardClient from "./SalesBoardClient";

export const dynamic = "force-dynamic";

type RawProperty = {
  id: number;
  address: string;
  cover_photo_id: number | null;
  contacts: { last_name: string | null } | null;
};

type FallbackPhotoRow = Pick<DealPhoto, "media_type" | "storage_path" | "poster_path" | "bucket"> & {
  property_id: number;
};

/**
 * Maps property id -> displayable URL of that property's key photo, for the
 * deal-card hover preview. Resolved here rather than on hover so the preview
 * paints immediately; only the image bytes load lazily.
 *
 * Mirrors what the photo gallery shows on an album tile, which is
 * `photos.find(id === coverPhotoId) ?? photos[0]` — so a property with photos
 * but no cover chosen still previews something instead of reading as empty:
 *
 *   1. the explicit cover (properties.cover_photo_id), then
 *   2. whatever the gallery would have fallen back to, via the
 *      property_fallback_photos() RPC (see that function for the ordering, and
 *      for why it groups by events.property_id rather than by the deal).
 *
 * The fallback lives in SQL because picking it in JS would mean pulling every
 * event photo in the database to use one row per property.
 *
 * Covers are looked up by photo id in one batch query rather than embedded:
 * deal_photos is a junction across events/deals/properties, so embedding it
 * risks PostgREST ambiguity (the same reason /api/properties/[id]/cover uses
 * two plain queries).
 */
async function loadPropertyCoverUrls(properties: RawProperty[]): Promise<Record<number, string>> {
  const coverIds = [...new Set(properties.map((p) => p.cover_photo_id).filter((id): id is number => id != null))];

  const [coversRes, fallbackRes] = await Promise.all([
    coverIds.length > 0
      ? supabase.from("deal_photos").select("id, storage_path, poster_path, media_type, bucket").in("id", coverIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc("property_fallback_photos"),
  ]);

  const urls: Record<number, string> = {};

  // Fallbacks first so an explicit cover always overwrites one. A failure in
  // either lookup costs previews, not the board — the page still renders.
  if (!fallbackRes.error) {
    for (const row of (fallbackRes.data ?? []) as FallbackPhotoRow[]) {
      const url = dealThumbUrl(row);
      if (url) urls[row.property_id] = url;
    }
  }

  if (!coversRes.error) {
    const photosById = new Map<number, Pick<DealPhoto, "media_type" | "storage_path" | "poster_path" | "bucket">>();
    for (const photo of coversRes.data ?? []) photosById.set(photo.id, photo);

    for (const property of properties) {
      if (property.cover_photo_id == null) continue;
      const photo = photosById.get(property.cover_photo_id);
      // A cover pointing at a deleted photo, or at a video whose poster capture
      // failed, has nothing renderable. Leave whatever the fallback found in
      // place rather than blanking the property out.
      const url = photo ? dealThumbUrl(photo) : null;
      if (url) urls[property.id] = url;
    }
  }

  return urls;
}

export default async function SalesBoardPage() {
  const [dealsRes, propertiesRes, nextActionsRes, hoverPropertyPhoto, hoverPropertyPhotoWide] =
    await Promise.all([
      supabase.from("Sales Board").select(DEAL_EVENTS_SELECT).order("created_at", { ascending: true }),
      supabase
        .from("properties")
        .select("id, address, cover_photo_id, contacts(last_name)")
        .order("address", { ascending: true }),
      supabase.from("tasks").select("deal_id, title").eq("is_next_action", true),
      getFlagSetting(SALES_BOARD_HOVER_PHOTO_KEY),
      getFlagSetting(SALES_BOARD_HOVER_PHOTO_WIDE_KEY),
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

  // Loaded unconditionally: the hover preview gates on its setting, but the
  // Tile view is photo-first and needs a cover for every property regardless.
  // It's one batched id lookup plus one RPC — cheap for a single business's
  // pipeline — and both features read from the same map.
  const propertyCoverUrls = await loadPropertyCoverUrls(rawProperties);

  return (
    <SalesBoardClient
      initialDeals={deals}
      initialPropertyOptions={propertyOptions}
      hoverPropertyPhoto={hoverPropertyPhoto}
      hoverPropertyPhotoWide={hoverPropertyPhotoWide}
      propertyCoverUrls={propertyCoverUrls}
    />
  );
}
