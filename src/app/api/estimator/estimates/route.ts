import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { mapEstimateSummary, type EstimateRow } from "@/lib/estimator/estimateMap";

const SUMMARY_COLUMNS = "id, deal_id, property_id, project_name, client_name, estimate_date, total, updated_at";

export async function GET() {
  const { data, error } = await supabase
    .from("estimates")
    .select(SUMMARY_COLUMNS)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ estimates: (data ?? []).map((r) => mapEstimateSummary(r as EstimateRow)) });
}

// Create a new estimate. Body is optional — a bare POST makes a blank one.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body → blank estimate */
  }

  const insert: Record<string, unknown> = {
    project_name: typeof body.projectName === "string" ? body.projectName : "",
    client_name: typeof body.clientName === "string" ? body.clientName : "",
    estimate_date: body.date ?? new Date().toISOString().split("T")[0],
    tax_rate: typeof body.taxRate === "number" ? body.taxRate : 0,
    notes: typeof body.notes === "string" ? body.notes : "",
    rows: Array.isArray(body.rows) ? body.rows : [],
    plan: body.plan && typeof body.plan === "object" ? body.plan : {},
    delivery_rate: typeof body.deliveryRate === "number" ? body.deliveryRate : null,
  };
  // Optional deal/property linkage (used when creating from a deal in Phase 4).
  if (typeof body.dealId === "number") insert.deal_id = body.dealId;
  if (typeof body.propertyId === "number") insert.property_id = body.propertyId;

  const { data, error } = await supabase.from("estimates").insert(insert).select("id").single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
