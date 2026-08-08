import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ESTIMATE_PLANS_BUCKET, planImageUrl } from "@/lib/estimator/estimatePlan";
import { DEAL_PHOTOS_BUCKET, dealPhotoUrl, SITE_PLAN_IMAGE_TYPE } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

// The estimator's Plan-view image. When the estimate is linked to a deal, the
// image is stored as that deal's "Site_Plan_Image" — an event-less deal photo
// that shows in the deal's gallery (one per deal, replaced on re-upload). When
// the estimate isn't linked to a deal, it falls back to the estimate-plans
// bucket keyed on the estimate.

async function removeDealSitePlans(dealId: number) {
  const { data: existing } = await supabase
    .from("deal_photos")
    .select("id, storage_path")
    .eq("deal_id", dealId)
    .eq("photo_type", SITE_PLAN_IMAGE_TYPE);
  const rows = existing ?? [];
  if (rows.length > 0) {
    await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove(rows.map((r) => r.storage_path));
    await supabase.from("deal_photos").delete().in(
      "id",
      rows.map((r) => r.id)
    );
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are supported" }, { status: 400 });
  }

  const { data: estimate, error: existingError } = await supabase
    .from("estimates")
    .select("deal_id, plan_image_path")
    .eq("id", id)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!estimate) {
    return NextResponse.json({ error: "estimate not found" }, { status: 404 });
  }

  const ext = safeExtension(file.name, "png");

  // ── Deal-linked: store as the deal's Site_Plan_Image (replace existing) ──
  if (estimate.deal_id != null) {
    const path = `deal-${estimate.deal_id}/site-plan-${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(DEAL_PHOTOS_BUCKET)
      .upload(path, file, { contentType: file.type || "image/png" });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Replace: one site plan per deal.
    await removeDealSitePlans(estimate.deal_id);

    const { error: insertError } = await supabase.from("deal_photos").insert({
      deal_id: estimate.deal_id,
      event_id: null,
      storage_path: path,
      media_type: "photo",
      photo_type: SITE_PLAN_IMAGE_TYPE,
    });
    if (insertError) {
      await supabase.storage.from(DEAL_PHOTOS_BUCKET).remove([path]);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // A previously-unlinked estimate may have left an estimate-plans image behind.
    if (estimate.plan_image_path) {
      await supabase.storage.from(ESTIMATE_PLANS_BUCKET).remove([estimate.plan_image_path]);
      await supabase.from("estimates").update({ plan_image_path: null }).eq("id", id);
    }

    return NextResponse.json({ path, url: dealPhotoUrl(path) });
  }

  // ── Unlinked estimate: estimate-plans bucket keyed on the estimate ──
  const path = `estimate-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(ESTIMATE_PLANS_BUCKET)
    .upload(path, file, { contentType: file.type || "image/png" });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("estimates")
    .update({ plan_image_path: path, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) {
    await supabase.storage.from(ESTIMATE_PLANS_BUCKET).remove([path]);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (estimate.plan_image_path) {
    await supabase.storage.from(ESTIMATE_PLANS_BUCKET).remove([estimate.plan_image_path]);
  }

  return NextResponse.json({ path, url: planImageUrl(path) });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: estimate, error: existingError } = await supabase
    .from("estimates")
    .select("deal_id, plan_image_path")
    .eq("id", id)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (estimate?.deal_id != null) {
    await removeDealSitePlans(estimate.deal_id);
  }
  if (estimate?.plan_image_path) {
    await supabase.storage.from(ESTIMATE_PLANS_BUCKET).remove([estimate.plan_image_path]);
    await supabase.from("estimates").update({ plan_image_path: null, updated_at: new Date().toISOString() }).eq("id", id);
  }

  return NextResponse.json({ ok: true });
}
