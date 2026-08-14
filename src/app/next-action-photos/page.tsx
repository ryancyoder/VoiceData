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

// An album of every deal's "next action" — its ⚡ photo (the marker set in the
// photo gallery) and/or the title of its is_next_action task. One card per
// deal, sorted by property label. Deals whose next action has no photo still
// appear (over a blank placeholder tile); the client's "text-only" toggle
// chooses whether to include them. The photo lives in deal_photos and is
// fetched by id (a plain query — deal_photos is a junction across events/
// deals/properties, so embedding it risks PostgREST ambiguity).
export default async function NextActionPhotosPage() {
  // The next actions themselves: one is_next_action task per deal (enforced by
  // a partial unique index), giving every deal that has a next action at all.
  const { data: taskData, error: taskError } = await supabase
    .from("tasks")
    .select("deal_id, title")
    .eq("is_next_action", true);
  if (taskError) {
    throw new Error(`Failed to load next actions: ${taskError.message}`);
  }
  const nextActionByDeal = new Map<number, string>();
  for (const t of (taskData ?? []) as unknown as { deal_id: number | null; title: string | null }[]) {
    if (t.deal_id != null && t.title?.trim()) nextActionByDeal.set(t.deal_id, t.title.trim());
  }

  // Deals to show = those with a next-action photo ∪ those with a next-action
  // task. Fetched as two plain queries and merged by id (a deal can be in both).
  const dealById = new Map<number, DealRow>();
  const taskDealIds = [...nextActionByDeal.keys()];
  const [photoDealsRes, taskDealsRes] = await Promise.all([
    supabase
      .from("Sales Board")
      .select("id, deal_name, property_id, next_action_photo_id")
      .not("next_action_photo_id", "is", null),
    taskDealIds.length > 0
      ? supabase.from("Sales Board").select("id, deal_name, property_id, next_action_photo_id").in("id", taskDealIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (photoDealsRes.error) {
    throw new Error(`Failed to load deals: ${photoDealsRes.error.message}`);
  }
  if (taskDealsRes.error) {
    throw new Error(`Failed to load deals: ${taskDealsRes.error.message}`);
  }
  for (const d of ([...(photoDealsRes.data ?? []), ...(taskDealsRes.data ?? [])] as unknown as DealRow[])) {
    dealById.set(d.id, d);
  }
  const deals = [...dealById.values()];

  // The chosen next-action photos (deal_photos rows), fetched by id.
  const photoIds = deals.map((d) => d.next_action_photo_id).filter((v): v is number => v != null);
  const photoById = new Map<number, DealPhoto>();
  if (photoIds.length > 0) {
    const { data: photoRows, error: photoError } = await supabase.from("deal_photos").select("*").in("id", photoIds);
    if (photoError) {
      throw new Error(`Failed to load photos: ${photoError.message}`);
    }
    for (const p of (photoRows ?? []) as unknown as DealPhoto[]) photoById.set(p.id, p);
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
        url: photo != null ? dealThumbUrl(photo) : null,
        caption: photo?.caption ?? null,
        nextAction: nextActionByDeal.get(d.id) ?? null,
      };
    })
    // A card needs at least a photo or a next-action title to be worth showing.
    .filter((c) => c.url != null || c.nextAction != null)
    .sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel));

  return <NextActionPhotosClient cards={cards} />;
}
