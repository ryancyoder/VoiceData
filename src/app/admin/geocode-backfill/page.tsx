import { supabase } from "@/lib/supabaseClient";
import GeocodeBackfillClient from "./GeocodeBackfillClient";

export const dynamic = "force-dynamic";

export default async function GeocodeBackfillPage() {
  const { count, error } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .is("latitude", null);

  if (error) {
    throw new Error(`Failed to load backfill status: ${error.message}`);
  }

  return <GeocodeBackfillClient initialRemaining={count ?? 0} />;
}
