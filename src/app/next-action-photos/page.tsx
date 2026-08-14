import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { formatPropertyLabel, dealThumbUrl, type DealPhoto } from "@/lib/salesBoard";

export const dynamic = "force-dynamic";

type PropRow = {
  id: number;
  address: string;
  next_action_photo_id: number | null;
  contacts: { last_name: string | null } | null;
};

// An album of every property's chosen "next action" photo (the ⚡ marker set
// in the photo gallery) — one card per property, newest markers first isn't
// meaningful here so cards sort by property label. The photo itself lives in
// deal_photos and is fetched by id (a plain query — deal_photos is a junction
// across events/deals/properties, so embedding it risks PostgREST ambiguity).
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

  const cards = props
    .map((p) => ({
      propertyId: p.id,
      label: formatPropertyLabel({ address: p.address, contactLastName: p.contacts?.last_name ?? null }),
      photo: p.next_action_photo_id != null ? photoById.get(p.next_action_photo_id) ?? null : null,
    }))
    .filter((c): c is { propertyId: number; label: string; photo: DealPhoto } => c.photo != null)
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Next Action Photos</h1>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {cards.length} {cards.length === 1 ? "property" : "properties"}
        </span>
      </div>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No next-action photos yet. In the{" "}
          <Link href="/photos" className="underline">
            Photos
          </Link>{" "}
          gallery, tap the ⚡ on a photo to mark it as a property&apos;s next-action photo.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((card) => {
            const url = dealThumbUrl(card.photo);
            return (
              <Link
                key={card.propertyId}
                href={`/photos?property=${card.propertyId}`}
                className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                title={`${card.label} — view in gallery`}
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={card.photo.caption ?? card.label}
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-2xl">🖼</span>
                  )}
                  <span className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#4C82F7] text-xs text-white shadow">
                    ⚡
                  </span>
                </div>
                <div className="truncate px-3 py-2 text-sm font-medium text-zinc-800 dark:text-zinc-200" title={card.label}>
                  {card.label}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
