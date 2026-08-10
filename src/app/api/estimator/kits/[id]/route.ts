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

type RouteParams = { params: Promise<{ id: string }> };

// Kits are edited in place (rename, recolor, change takeoff unit, and — less
// commonly — their items). Changes arrive as a partial kit; merge them onto the
// current kit, write the parent columns, and replace child rows if items changed.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const changes = (await req.json()) as Record<string, unknown>;

  const [kitRes, itemsRes] = await Promise.all([
    supabase.from("assembly_kits").select(KIT_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("assembly_kit_items").select(KIT_ITEM_COLUMNS).eq("kit_id", id),
  ]);

  if (kitRes.error) {
    return NextResponse.json({ error: kitRes.error.message }, { status: 500 });
  }
  if (!kitRes.data) {
    return NextResponse.json({ error: "kit not found" }, { status: 404 });
  }
  if (itemsRes.error) {
    return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  }

  const current = rowToKit(
    kitRes.data as unknown as KitRow,
    (itemsRes.data ?? []) as unknown as KitItemRow[]
  );
  const merged = { ...current, ...changes, id } as Kit;

  const { error: updateError } = await supabase
    .from("assembly_kits")
    .update(kitToParentRow(merged))
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Only touch child rows when the caller actually sent new items.
  if (Object.prototype.hasOwnProperty.call(changes, "items")) {
    const { error: delError } = await supabase.from("assembly_kit_items").delete().eq("kit_id", id);
    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 500 });
    }
    const itemRows = (merged.items ?? []).map((it, idx) => kitItemToRow(it, id, idx));
    if (itemRows.length > 0) {
      const { error: insError } = await supabase.from("assembly_kit_items").insert(itemRows);
      if (insError) {
        return NextResponse.json({ error: insError.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ kit: merged });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Child rows are removed by the ON DELETE CASCADE foreign key.
  const { error } = await supabase.from("assembly_kits").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
