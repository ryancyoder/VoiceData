import { supabase } from "@/lib/supabaseClient";
import type { Deal } from "@/lib/salesBoard";
import SalesBoardClient from "./SalesBoardClient";

export const dynamic = "force-dynamic";

export default async function SalesBoardPage() {
  const { data, error } = await supabase
    .from("Sales Board")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load Sales Board: ${error.message}`);
  }

  return <SalesBoardClient initialDeals={(data ?? []) as Deal[]} />;
}
