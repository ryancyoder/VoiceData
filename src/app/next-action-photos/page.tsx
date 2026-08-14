import { supabase } from "@/lib/supabaseClient";
import { formatPropertyLabel, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";
import { NextActionPhotosClient, type NextActionCard } from "./NextActionPhotosClient";

export const dynamic = "force-dynamic";

type DealRow = {
  id: number;
  deal_name: string;
  property_id: number | null;
  next_action_photo_id: number | null;
};

type PropRow = { id: number; address: string; contacts: { last_name: string | null } | null };

// An album of every deal's chosen "next action" photo (the ⚡ marker set in
// the photo gallery) — one card per deal, sorted by property label. The photo
// itself lives in deal_photos and is fetched by id (a plain query — deal_photos
// is a junction across events/deals/properties, so embedding it risks
// PostgREST ambiguity). The "next action" *text* overlaid on each photo is the
// title of the deal's is_next_action task.
export default async function NextActionPhotosPage() {
  const { data: dealData, error: dealError } = await supabase
    .from("Sales Board")
    .select("id, deal_name, property_id, next_action_photo_id")
    .not("next_action_photo_id", "is", null);
  if (dealError) {
    throw new Error(`Failed to load deals: ${dealError.message}`);
  }
  const deals = (dealData ?? []) as unknown as DealRow[];

  const photoIds = deals.map((d) => d.next_action_photo_id).filter((v): v is number => v != null);
  const photoById = new Map<number, DealPhoto>();
  if (photoIds.length > 0) {
    const { data: photoRows, error: photoError } = await supabase.from("deal_photos").select("*").in("id", photoIds);
    if (photoError) {
      throw new Error(`Failed to load photos: ${photoError.message}`);
    }
    for (const p of (photoRows ?? []) as unknown as DealPhoto[]) photoById.set(p.id, p);
  }

  // The deal's next-action task title (one per deal, enforced by is_next_action).
  const dealIds = deals.map((d) => d.id);
  const nextActionByDeal = new Map<number, string>();
  if (dealIds.length > 0) {
    const { data: taskRows } = await supabase
      .from("tasks")
      .select("deal_id, title")
      .eq("is_next_action", true)
      .in("deal_id", dealIds);
    for (const t of (taskRows ?? []) as unknown as { deal_id: number | null; title: string | null }[]) {
      if (t.deal_id != null && t.title?.trim()) nextActionByDeal.set(t.deal_id, t.title.trim());
    }
  }

  // Property labels (address + contact) for each deal's property.
  const propertyIds = [...new Set(deals.map((d) => d.property_id).filter((v): v is number => v != null))];
  const propById = new Map<number, PropRow>();
  if (propertyIds.length > 0) {
    const { data: propRows } = await supabase
      .from("properties")
      .select("id, address, contacts(last_name)")
      .in("id", propertyIds);
    for (const p of (propRows ?? []) as unknown as PropRow[]) propById.set(p.id, p);
  }

  const cards: NextActionCard[] = deals
    .map((d) => {
      const photo = d.next_action_photo_id != null ? photoById.get(d.next_action_photo_id) ?? null : null;
      const prop = d.property_id != null ? propById.get(d.property_id) ?? null : null;
      const propertyLabel = prop
        ? formatPropertyLabel({ address: prop.address, contactLastName: prop.contacts?.last_name ?? null })
        : d.deal_name;
      return {
        dealId: d.id,
        propertyId: d.property_id,
        propertyLabel,
        dealName: d.deal_name,
        photo,
        url: photo != null ? dealThumbUrl(photo) : null,
        caption: photo?.caption ?? null,
        nextAction: nextActionByDeal.get(d.id) ?? null,
      };
    })
    .filter((c) => c.photo != null)
    .map(({ dealId, propertyId, propertyLabel, dealName, url, caption, nextAction }) => ({
      dealId,
      propertyId,
      propertyLabel,
      dealName,
      url,
      caption,
      nextAction,
    }))
    .sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel));

  return <NextActionPhotosClient cards={cards} />;
}
