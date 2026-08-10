import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { STAGES } from "@/lib/salesBoard";

export const dynamic = "force-dynamic";

const STAGE_SET = new Set<string>(STAGES);

// Per-stage default effort hours (used when a deal has no estimatedHours override).
export async function GET() {
  const { data, error } = await supabase.from("stage_effort_defaults").select("stage, default_hours");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const defaults: Record<string, number> = {};
  for (const row of data ?? []) defaults[row.stage as string] = Number(row.default_hours);
  return NextResponse.json({ defaults });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { defaults?: Record<string, unknown> };
  const entries = Object.entries(body.defaults ?? {});

  const rows: { stage: string; default_hours: number }[] = [];
  for (const [stage, value] of entries) {
    if (!STAGE_SET.has(stage)) continue;
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours < 0) continue;
    rows.push({ stage, default_hours: hours });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("stage_effort_defaults").upsert(rows, { onConflict: "stage" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
