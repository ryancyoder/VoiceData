import { supabase } from "@/lib/supabaseClient";
import type { Deal } from "@/lib/salesBoard";
import { mapRawDealEvents, DEAL_EVENTS_SELECT } from "@/lib/dealEvents";
import PhotoGalleryClient from "./PhotoGalleryClient";

export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  const { data, error } = await supabase
    .from("Sales Board")
    .select(DEAL_EVENTS_SELECT)
    .order("deal_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load photos: ${error.message}`);
  }

  const deals = mapRawDealEvents(data ?? []) as Pick<Deal, "id" | "deal_name" | "company" | "stage" | "lost_at" | "events">[];

  return <PhotoGalleryClient deals={deals} />;
}
