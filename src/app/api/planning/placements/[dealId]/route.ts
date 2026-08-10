import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ dealId: string }> };

// Pin a deal to a block window (upsert), or reset it to auto (delete).
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { dealId } = await params;
  const id = Number(dealId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid deal id" }, { status: 400 });
  }

  const body = (await req.json()) as { blockId?: unknown; date?: unknown; position?: unknown };
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  const row = {
    deal_id: id,
    block_id: typeof body.blockId === "string" ? body.blockId : null,
    date: body.date,
    position: Number.isFinite(Number(body.position)) ? Number(body.position) : 0,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("planning_placements").upsert(row, { onConflict: "deal_id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { dealId } = await params;
  const id = Number(dealId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid deal id" }, { status: 400 });
  }
  const { error } = await supabase.from("planning_placements").delete().eq("deal_id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
