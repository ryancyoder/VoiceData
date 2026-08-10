import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { catalogPhotoUrl, type CatalogPhoto } from "@/lib/estimator/catalogPhotos";
import {
  CATALOG_ITEM_COLUMNS,
  rowToItem,
  itemToRow,
  type CatalogItem,
  type CatalogItemRow,
} from "@/lib/estimator/catalogItemColumns";

// The catalog is edited locally in the Catalog Editor and persisted as a
// whole on Save (matching the app's existing edit-then-save UX), so this is a
// collection endpoint: GET returns the full catalog + delivery rate + photos,
// PUT replaces items + delivery rate. Each item's fields live in first-class
// typed columns, which the app both reads and writes. The legacy `data` jsonb
// is a DB-derived copy (maintained by a trigger) for readers not yet migrated;
// the app never writes it. Photos are managed separately.

export async function GET() {
  const [itemsRes, settingsRes, photosRes] = await Promise.all([
    supabase.from("catalog_items").select(CATALOG_ITEM_COLUMNS).order("sort_order", { ascending: true }),
    supabase.from("estimator_settings").select("delivery_rate").eq("id", 1).maybeSingle(),
    supabase
      .from("catalog_item_photos")
      .select("id, catalog_item_id, storage_path, is_cover")
      .order("created_at", { ascending: true }),
  ]);

  if (itemsRes.error) {
    return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  }
  if (settingsRes.error) {
    return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
  }
  if (photosRes.error) {
    return NextResponse.json({ error: photosRes.error.message }, { status: 500 });
  }

  const items = ((itemsRes.data ?? []) as unknown as CatalogItemRow[]).map(rowToItem);
  const deliveryRate = settingsRes.data?.delivery_rate ?? 80;

  // Group photos by catalog item id, cover first.
  const photos: Record<string, CatalogPhoto[]> = {};
  for (const row of photosRes.data ?? []) {
    const list = (photos[row.catalog_item_id] ??= []);
    list.push({ id: row.id, url: catalogPhotoUrl(row.storage_path), is_cover: row.is_cover });
  }
  for (const id of Object.keys(photos)) {
    photos[id].sort((a, b) => Number(b.is_cover) - Number(a.is_cover));
  }

  return NextResponse.json({ items, deliveryRate: Number(deliveryRate), photos });
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
  // itemToRow emits only the typed columns; the DB trigger derives `data`.
  const rows = items.map((item, idx) => itemToRow(item, idx));
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
