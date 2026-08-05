import { supabase } from "@/lib/supabaseClient";
import type { Deal } from "@/lib/salesBoard";
import PhotoGalleryClient from "./PhotoGalleryClient";

export const dynamic = "force-dynamic";

export default async function PhotosPage() {
  const { data, error } = await supabase
    .from("Sales Board")
    .select("id, deal_name, company, stage, lost_at, photos:deal_photos(*)")
    .order("deal_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load photos: ${error.message}`);
  }

  return <PhotoGalleryClient deals={(data ?? []) as Pick<Deal, "id" | "deal_name" | "company" | "stage" | "lost_at" | "photos">[]} />;
}
