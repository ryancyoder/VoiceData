import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// A lightweight index for the command palette — id/label/subtitle only,
// not the full nested rows /api/sales-board and /api/properties return.
// The record counts here are small enough (a single business's pipeline)
// that fetching everything once and filtering client-side, Spotlight-
// style, is simpler and feels faster than a debounced server search.
export async function GET() {
  const [dealsRes, propertiesRes] = await Promise.all([
    supabase.from("Sales Board").select("id, deal_name, company, stage, lost_at, property_id").order("deal_name"),
    supabase.from("properties").select("id, address, contacts(first_name, last_name)").order("address"),
  ]);

  if (dealsRes.error) {
    return NextResponse.json({ error: dealsRes.error.message }, { status: 500 });
  }
  if (propertiesRes.error) {
    return NextResponse.json({ error: propertiesRes.error.message }, { status: 500 });
  }

  const deals = (dealsRes.data ?? []).map((d) => ({
    id: d.id,
    label: d.deal_name,
    subtitle: [d.company, d.lost_at ? "Lost" : d.stage].filter(Boolean).join(" · ") || null,
    property_id: d.property_id ?? null,
  }));

  const properties = (propertiesRes.data ?? []).map((p) => {
    const contact = p.contacts as unknown as { first_name: string | null; last_name: string | null } | null;
    const contactName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : "";
    return {
      id: p.id,
      label: p.address,
      subtitle: contactName || null,
    };
  });

  return NextResponse.json({ deals, properties });
}
