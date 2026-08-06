import { supabase } from "@/lib/supabaseClient";
import type { Deal, PropertyOption } from "@/lib/salesBoard";
import { mapRawDealEvents, DEAL_EVENTS_SELECT } from "@/lib/dealEvents";
import SalesBoardClient from "./SalesBoardClient";

export const dynamic = "force-dynamic";

export default async function SalesBoardPage() {
  const [dealsRes, propertiesRes] = await Promise.all([
    supabase.from("Sales Board").select(DEAL_EVENTS_SELECT).order("created_at", { ascending: true }),
    supabase.from("properties").select("id, address, contacts(last_name)").order("address", { ascending: true }),
  ]);

  if (dealsRes.error) {
    throw new Error(`Failed to load Sales Board: ${dealsRes.error.message}`);
  }
  if (propertiesRes.error) {
    throw new Error(`Failed to load Sales Board: ${propertiesRes.error.message}`);
  }

  const deals: Deal[] = mapRawDealEvents(dealsRes.data ?? []);
  const rawProperties = (propertiesRes.data ?? []) as unknown as {
    id: number;
    address: string;
    contacts: { last_name: string | null } | null;
  }[];
  const propertyOptions: PropertyOption[] = rawProperties.map((p) => ({
    id: p.id,
    address: p.address,
    contactLastName: p.contacts?.last_name ?? null,
  }));

  return <SalesBoardClient initialDeals={deals} initialPropertyOptions={propertyOptions} />;
}
