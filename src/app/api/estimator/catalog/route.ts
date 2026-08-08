import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// The catalog is edited locally in the Catalog Editor and persisted as a
// whole on Save (matching the app's existing edit-then-save UX), so this is a
// collection endpoint: GET returns the full catalog + delivery rate, PUT
// replaces it. Each row's `data` jsonb is the full frontend (camelCase) item.

export async function GET() {
  const [itemsRes, settingsRes] = await Promise.all([
    supabase.from("catalog_items").select("data").order("sort_order", { ascending: true }),
    supabase.from("estimator_settings").select("delivery_rate").eq("id", 1).maybeSingle(),
  ]);

  if (itemsRes.error) {
    return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  }
  if (settingsRes.error) {
    return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
  }

  const items = (itemsRes.data ?? []).map((row) => row.data);
  const deliveryRate = settingsRes.data?.delivery_rate ?? 80;

  return NextResponse.json({ items, deliveryRate: Number(deliveryRate) });
}

interface CatalogItem {
  id: string;
  [key: string]: unknown;
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { items?: CatalogItem[]; deliveryRate?: number };
  const items = body.items ?? [];

  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }
  if (items.some((it) => !it || typeof it.id !== "string" || !it.id)) {
    return NextResponse.json({ error: "every catalog item needs a string id" }, { status: 400 });
  }

  // Upsert everything the client sent, stamping sort_order from array position.
  const rows = items.map((item, idx) => ({ id: item.id, sort_order: idx, data: item, updated_at: new Date().toISOString() }));
  if (rows.length > 0) {
    const { error: upsertError } = await supabase.from("catalog_items").upsert(rows);
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  // Delete rows the client no longer has (items removed in the editor).
  const keepIds = new Set(items.map((it) => it.id));
  const { data: existing, error: existingError } = await supabase.from("catalog_items").select("id");
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  const toDelete = (existing ?? []).map((r) => r.id as string).filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase.from("catalog_items").delete().in("id", toDelete);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
  }

  if (typeof body.deliveryRate === "number") {
    const { error: settingsError } = await supabase
      .from("estimator_settings")
      .update({ delivery_rate: body.deliveryRate, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (settingsError) {
      return NextResponse.json({ error: settingsError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: items.length });
}
