import { supabase } from "@/lib/supabaseClient";
import type { Deal } from "@/lib/salesBoard";
import { mapRawDealEvents, DEAL_EVENTS_SELECT } from "@/lib/dealEvents";
import SalesBoardClient from "./SalesBoardClient";

export const dynamic = "force-dynamic";

export default async function SalesBoardPage() {
  const { data, error } = await supabase
    .from("Sales Board")
    .select(DEAL_EVENTS_SELECT)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load Sales Board: ${error.message}`);
  }

  const deals: Deal[] = mapRawDealEvents(data ?? []);

  return <SalesBoardClient initialDeals={deals} />;
}
