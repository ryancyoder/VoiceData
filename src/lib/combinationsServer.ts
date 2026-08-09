import { supabase } from "@/lib/supabaseClient";
import type { Combination, CombinationPlant } from "@/lib/combinations";

// Server-only helper: fetch a single combination with its linked plants
// embedded. Kept out of the route files (which may only export HTTP handlers)
// and out of combinations.ts (which is imported by client components).
export async function fetchCombination(id: string): Promise<Combination | null> {
  const { data, error } = await supabase
    .from("plant_combinations")
    .select(
      "id, title, notes, image, created_at, updated_at, links:plant_combination_plants(plant:plants(id, botanical, common, genus, species, image))"
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  // supabase-js types a nested to-one embed as an array; at runtime `plant` is a
  // single object, so bridge through unknown.
  const links = (data.links ?? []) as unknown as { plant: CombinationPlant | null }[];
  const plants = links.map((l) => l.plant).filter((p): p is CombinationPlant => !!p);
  return {
    id: data.id as string,
    title: (data.title as string | null) ?? null,
    notes: (data.notes as string | null) ?? null,
    image: (data.image as string | null) ?? null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
    plants,
  };
}
