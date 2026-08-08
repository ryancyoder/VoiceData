import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ESTIMATE_PLANS_BUCKET, planImageUrl } from "@/lib/estimator/estimatePlan";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

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

  const { data: existing, error: existingError } = await supabase
    .from("estimates")
    .select("plan_image_path")
    .eq("id", id)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "estimate not found" }, { status: 404 });
  }

  const ext = safeExtension(file.name, "png");
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

  // The previous plan image is now dead weight.
  if (existing.plan_image_path) {
    await supabase.storage.from(ESTIMATE_PLANS_BUCKET).remove([existing.plan_image_path]);
  }

  return NextResponse.json({ path, url: planImageUrl(path) });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: existing, error: existingError } = await supabase
    .from("estimates")
    .select("plan_image_path")
    .eq("id", id)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existing?.plan_image_path) {
    await supabase.storage.from(ESTIMATE_PLANS_BUCKET).remove([existing.plan_image_path]);
  }

  const { error } = await supabase
    .from("estimates")
    .update({ plan_image_path: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
