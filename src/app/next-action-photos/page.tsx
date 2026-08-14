import { supabase } from "@/lib/supabaseClient";
import { formatPropertyLabel, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";
import { NextActionPhotosClient, type NextActionCard } from "./NextActionPhotosClient";

export const dynamic = "force-dynamic";

type PropRow = {
  id: number;
  address: string;
  next_action_photo_id: number | null;
  contacts: { last_name: string | null } | null;
};

// An album of every property's chosen "next action" photo (the ⚡ marker set
// in the photo gallery) — one card per property, sorted by property label.
// The photo itself lives in deal_photos and is fetched by id (a plain query —
// deal_photos is a junction across events/deals/properties, so embedding it
// risks PostgREST ambiguity). The "next action" *text* overlaid on each photo
// is the title of whichever task is flagged is_next_action for one of the
// property's deals, reached property → Sales Board deal → tasks.
export default async function NextActionPhotosPage() {
  const { data: propsData, error: propsError } = await supabase
    .from("properties")
    .select("id, address, next_action_photo_id, contacts(last_name)")
    .not("next_action_photo_id", "is", null);
  if (propsError) {
    throw new Error(`Failed to load properties: ${propsError.message}`);
  }
  const props = (propsData ?? []) as unknown as PropRow[];

  const photoIds = props.map((p) => p.next_action_photo_id).filter((v): v is number => v != null);
  const photoById = new Map<number, DealPhoto>();
  if (photoIds.length > 0) {
    const { data: photoRows, error: photoError } = await supabase.from("deal_photos").select("*").in("id", photoIds);
    if (photoError) {
      throw new Error(`Failed to load photos: ${photoError.message}`);
    }
    for (const p of (photoRows ?? []) as unknown as DealPhoto[]) photoById.set(p.id, p);
  }

  // Map each property to its next-action task text (property → deal → task).
  const propertyIds = props.map((p) => p.id);
  const nextActionByProperty = new Map<number, string>();
  if (propertyIds.length > 0) {
    const [dealsRes, tasksRes] = await Promise.all([
      supabase.from("Sales Board").select("id, property_id").in("property_id", propertyIds),
      supabase.from("tasks").select("deal_id, title").eq("is_next_action", true),
    ]);
    if (!dealsRes.error && !tasksRes.error) {
      const titleByDeal = new Map<number, string>();
      for (const t of (tasksRes.data ?? []) as unknown as { deal_id: number | null; title: string | null }[]) {
        if (t.deal_id != null && t.title?.trim()) titleByDeal.set(t.deal_id, t.title.trim());
      }
      for (const d of (dealsRes.data ?? []) as unknown as { id: number; property_id: number | null }[]) {
        const title = titleByDeal.get(d.id);
        // First deal with a next-action title wins for a given property.
        if (title && d.property_id != null && !nextActionByProperty.has(d.property_id)) {
          nextActionByProperty.set(d.property_id, title);
        }
      }
    }
  }

  const cards: NextActionCard[] = props
    .map((p) => {
      const photo = p.next_action_photo_id != null ? photoById.get(p.next_action_photo_id) ?? null : null;
      return {
        propertyId: p.id,
        label: formatPropertyLabel({ address: p.address, contactLastName: p.contacts?.last_name ?? null }),
        photo,
        url: photo != null ? dealThumbUrl(photo) : null,
        caption: photo?.caption ?? null,
        nextAction: nextActionByProperty.get(p.id) ?? null,
      };
    })
    .filter((c) => c.photo != null)
    .map(({ propertyId, label, url, caption, nextAction }) => ({ propertyId, label, url, caption, nextAction }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return <NextActionPhotosClient cards={cards} />;
}
