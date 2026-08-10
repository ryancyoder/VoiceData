import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  PLANNING_BLOCK_COLUMNS,
  rowToBlock,
  buildBlockRow,
  type BlockInput,
  type PlanningBlockRow,
} from "@/lib/planning/blocks";

type RouteParams = { params: Promise<{ id: string }> };

// Blocks are edited in place. Changes arrive as a partial (camelCase) block;
// merge them onto the current block and rebuild the full row so the DB shape
// constraints (one-off vs recurring) always hold.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const changes = (await req.json()) as Record<string, unknown>;

  const { data: existing, error: fetchError } = await supabase
    .from("planning_blocks")
    .select(PLANNING_BLOCK_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "block not found" }, { status: 404 });
  }

  const current = rowToBlock(existing as unknown as PlanningBlockRow);
  const merged = { ...current, ...changes } as unknown as BlockInput;

  const built = buildBlockRow(merged);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("planning_blocks")
    .update(built.row)
    .eq("id", id)
    .select(PLANNING_BLOCK_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ block: rowToBlock(data as unknown as PlanningBlockRow) });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { error } = await supabase.from("planning_blocks").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
