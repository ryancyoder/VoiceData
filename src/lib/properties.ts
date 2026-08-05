import { supabase } from "@/lib/supabaseClient";
import { geocodeAddress } from "@/lib/geocode";
import type { Property } from "@/lib/salesBoard";

/**
 * Finds the Property row for an exact jobsite address, creating one
 * (and geocoding it) if this is the first deal ever seen at that address.
 * Reusing an existing property avoids re-geocoding the same address on
 * every deal that shares it.
 */
export async function findOrCreateProperty(address: string): Promise<Property | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const { data: existing, error: findError } = await supabase
    .from("properties")
    .select("*")
    .eq("address", trimmed)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (existing) return existing as Property;

  const geocoded = await geocodeAddress(trimmed);

  const { data: created, error: insertError } = await supabase
    .from("properties")
    .upsert(
      {
        address: trimmed,
        latitude: geocoded?.latitude ?? null,
        longitude: geocoded?.longitude ?? null,
        geocoded_at: new Date().toISOString(),
      },
      { onConflict: "address" }
    )
    .select()
    .single();

  if (insertError) throw new Error(insertError.message);
  return created as Property;
}
