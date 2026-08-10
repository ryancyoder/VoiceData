import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  KIT_COLUMNS,
  KIT_ITEM_COLUMNS,
  rowToKit,
  kitToParentRow,
  kitItemToRow,
  type Kit,
  type KitRow,
  type KitItemRow,
} from "@/lib/estimator/assemblyKitColumns";

// Assembly kits: parent fields live in assembly_kits columns; each kit's nested
// line items live in the assembly_kit_items child table. The app reads/writes
// only those; the legacy `data` jsonb is a DB-derived backup (trigger-maintained).

export async function GET() {
  const [kitsRes, itemsRes] = await Promise.all([
    supabase.from("assembly_kits").select(KIT_COLUMNS).order("created_at", { ascending: true }),
    supabase.from("assembly_kit_items").select(KIT_ITEM_COLUMNS),
  ]);

  if (kitsRes.error) {
    return NextResponse.json({ error: kitsRes.error.message }, { status: 500 });
  }
  if (itemsRes.error) {
    return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  }

  // Group child items by kit id (rowToKit sorts them by sort_order).
  const itemsByKit: Record<string, KitItemRow[]> = {};
  for (const row of (itemsRes.data ?? []) as unknown as KitItemRow[]) {
    (itemsByKit[row.kit_id] ??= []).push(row);
  }

  const kits = ((kitsRes.data ?? []) as unknown as KitRow[]).map((k) =>
    rowToKit(k, itemsByKit[k.id] ?? [])
  );

  return NextResponse.json({ kits });
}

export async function POST(req: NextRequest) {
  const kit = (await req.json()) as Kit;

  if (!kit || typeof kit.id !== "string" || !kit.id) {
    return NextResponse.json({ error: "kit needs a string id" }, { status: 400 });
  }

  const { error: kitError } = await supabase.from("assembly_kits").insert(kitToParentRow(kit));
  if (kitError) {
    return NextResponse.json({ error: kitError.message }, { status: 500 });
  }

  const itemRows = (kit.items ?? []).map((it, idx) => kitItemToRow(it, kit.id, idx));
  if (itemRows.length > 0) {
    const { error: itemsError } = await supabase.from("assembly_kit_items").insert(itemRows);
    if (itemsError) {
      // Roll back the parent so we don't leave a half-written kit.
      await supabase.from("assembly_kits").delete().eq("id", kit.id);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ kit }, { status: 201 });
}
