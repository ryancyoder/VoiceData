import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  PLANNING_BLOCK_COLUMNS,
  rowToBlock,
  buildBlockRow,
  type PlanningBlockRow,
} from "@/lib/planning/blocks";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("planning_blocks")
    .select(PLANNING_BLOCK_COLUMNS)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const blocks = ((data ?? []) as unknown as PlanningBlockRow[]).map(rowToBlock);
  return NextResponse.json({ blocks });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;

  const built = buildBlockRow(body ?? {});
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("planning_blocks")
    .insert(built.row)
    .select(PLANNING_BLOCK_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ block: rowToBlock(data as unknown as PlanningBlockRow) }, { status: 201 });
}
