import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { mapEstimateContent, type EstimateRow } from "@/lib/estimator/estimateMap";
import { ESTIMATE_PLANS_BUCKET } from "@/lib/estimator/estimatePlan";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data, error } = await supabase.from("estimates").select("*").eq("id", id).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "estimate not found" }, { status: 404 });
  }

  return NextResponse.json({ estimate: mapEstimateContent(data as EstimateRow) });
}

// Save an estimate's content (autosaved from the editor). Deliberately does
// NOT touch deal_id / property_id — linkage is managed separately (Phase 4) so
// autosave can never accidentally unlink a deal.
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  // imageDataUrl is derived from plan_image_path on read — never store the
  // (potentially base64) value in the jsonb.
  const plan = { ...((body.plan as Record<string, unknown>) ?? {}) };
  delete plan.imageDataUrl;

  const update: Record<string, unknown> = {
    project_name: typeof body.projectName === "string" ? body.projectName : "",
    client_name: typeof body.clientName === "string" ? body.clientName : "",
    estimate_date: body.date ?? null,
    tax_rate: typeof body.taxRate === "number" ? body.taxRate : 0,
    notes: typeof body.notes === "string" ? body.notes : "",
    rows: Array.isArray(body.rows) ? body.rows : [],
    plan,
    delivery_rate: typeof body.deliveryRate === "number" ? body.deliveryRate : null,
    subtotal: typeof body.subtotal === "number" ? body.subtotal : null,
    total: typeof body.total === "number" ? body.total : null,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error } = await supabase
    .from("estimates")
    .update(update)
    .eq("id", id)
    .select("deal_id, total")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Keep the linked deal's value in sync with the estimate total. Only push a
  // positive total, so an empty/just-created estimate never clobbers an
  // existing deal value (e.g. one imported from Aspire) with 0. Best-effort:
  // a failure here never fails the estimate save.
  if (saved?.deal_id != null && saved.total != null && Number(saved.total) > 0) {
    try {
      await supabase.from("Sales Board").update({ value: Number(saved.total) }).eq("id", saved.deal_id);
    } catch {
      /* value sync is supplementary */
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Clean up the plan image from Storage first (best-effort).
  const { data: existing } = await supabase
    .from("estimates")
    .select("plan_image_path")
    .eq("id", id)
    .maybeSingle();
  if (existing?.plan_image_path) {
    await supabase.storage.from(ESTIMATE_PLANS_BUCKET).remove([existing.plan_image_path]);
  }

  const { error } = await supabase.from("estimates").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
