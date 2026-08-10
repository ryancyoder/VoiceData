import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// Set (or clear) a deal's estimated_hours override used by the forecast.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);
  if (!Number.isInteger(dealId)) {
    return NextResponse.json({ error: "invalid deal id" }, { status: 400 });
  }

  const body = (await req.json()) as { hours?: unknown };
  let hours: number | null;
  if (body.hours === null || body.hours === undefined || body.hours === "") {
    hours = null;
  } else {
    const n = Number(body.hours);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "hours must be a non-negative number or null" }, { status: 400 });
    }
    hours = n;
  }

  const { error } = await supabase.from("Sales Board").update({ estimated_hours: hours }).eq("id", dealId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, estimatedHours: hours });
}
