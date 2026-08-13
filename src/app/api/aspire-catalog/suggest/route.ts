import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { bestMatches, type AspireCandidate } from "@/lib/aspireMatch";

// Propose the closest Aspire catalog items for a set of master materials, so the
// UI can offer confirm-to-map in bulk. The client posts material names (its live
// state, including unsaved edits); we score each against the whole catalog.
interface InMaterial { id: string; name: string }

export async function POST(req: NextRequest) {
  let body: { materials?: InMaterial[]; topN?: number };
  try {
    body = (await req.json()) as { materials?: InMaterial[]; topN?: number };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const materials = Array.isArray(body.materials) ? body.materials : [];
  const topN = Math.min(Math.max(Number(body.topN) || 5, 1), 10);
  if (materials.length === 0) return NextResponse.json({ results: [] });

  const { data, error } = await supabase
    .from("aspire_catalog")
    .select("item_name, category_name, item_type, purchase_unit_type, item_cost");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = (data ?? []) as AspireCandidate[];
  if (items.length === 0) {
    return NextResponse.json({ results: [], catalogEmpty: true });
  }

  const results = materials
    .filter((m) => m && typeof m.id === "string" && (m.name ?? "").trim())
    .map((m) => ({ id: m.id, name: m.name, suggestions: bestMatches(m.name, items, topN) }));

  return NextResponse.json({ results });
}
