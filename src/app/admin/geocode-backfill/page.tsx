import { supabase } from "@/lib/supabaseClient";
import GeocodeBackfillClient from "./GeocodeBackfillClient";

export const dynamic = "force-dynamic";

export default async function GeocodeBackfillPage() {
  const { data, error } = await supabase
    .from("Sales Board")
    .select("jobsite_address")
    .not("jobsite_address", "is", null)
    .is("geocoded_at", null);

  if (error) {
    throw new Error(`Failed to load backfill status: ${error.message}`);
  }

  const addresses = new Set<string>();
  for (const row of data ?? []) {
    const addr = (row as { jobsite_address: string | null }).jobsite_address?.trim();
    if (addr) addresses.add(addr);
  }

  return <GeocodeBackfillClient initialRemaining={addresses.size} />;
}
