import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// Search the Aspire catalog reference table for the master-catalog aspire_name
// picker. Returns the fields the picker shows: name, category, unit, cost.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 50);

  let query = supabase
    .from("aspire_catalog")
    .select("item_name, category_name, item_type, purchase_unit_type, item_cost")
    .order("item_name", { ascending: true })
    .limit(limit);

  if (q) {
    // Match the typed text anywhere in the item name or its category.
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(`item_name.ilike.${like},category_name.ilike.${like}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
