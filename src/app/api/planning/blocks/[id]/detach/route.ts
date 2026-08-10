import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { PLANNING_BLOCK_COLUMNS, rowToBlock, buildBlockRow, type PlanningBlockRow } from "@/lib/planning/blocks";

type RouteParams = { params: Promise<{ id: string }> };

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Detach a single recurring occurrence into its own one-off block: exclude the
// original date from the series, then create a one-off at the target date/time.
// The rest of the recurring series is unchanged.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as { date?: unknown; blockDate?: unknown; startTime?: unknown; endTime?: unknown };

  if (!isDate(body.date) || !isDate(body.blockDate)) {
    return NextResponse.json({ error: "date and blockDate (YYYY-MM-DD) are required" }, { status: 400 });
  }

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
  const block = rowToBlock(existing as unknown as PlanningBlockRow);
  if (block.kind !== "recurring") {
    return NextResponse.json({ error: "only recurring blocks can be detached" }, { status: 400 });
  }

  // Build (and validate) the new one-off, copying the series' stage/title/color.
  const built = buildBlockRow({
    stage: block.stage,
    title: block.title,
    color: block.color,
    kind: "one_off",
    blockDate: body.blockDate,
    startTime: body.startTime,
    endTime: body.endTime,
  });
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  // Exclude the detached date from the series.
  const excluded = [...new Set([...(block.excludedDates ?? []), body.date])].sort();
  const { error: updateError } = await supabase
    .from("planning_blocks")
    .update({ excluded_dates: excluded, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { data: created, error: insertError } = await supabase
    .from("planning_blocks")
    .insert(built.row)
    .select(PLANNING_BLOCK_COLUMNS)
    .single();
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ block: rowToBlock(created as unknown as PlanningBlockRow) }, { status: 201 });
}
