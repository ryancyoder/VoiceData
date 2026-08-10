import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

// All manual placements (the Planner overlay). A deal absent here is auto-seeded.
export async function GET() {
  const { data, error } = await supabase
    .from("planning_placements")
    .select("deal_id, block_id, date, position");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const placements = (data ?? []).map((r) => ({
    dealId: r.deal_id as number,
    blockId: r.block_id as string | null,
    date: r.date as string,
    position: r.position as number,
  }));
  return NextResponse.json({ placements });
}
