import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// Links between a take-off group (identified by its string id inside
// estimates.rows) and a deal_photos row, with an optional pin location on the
// plan image. Written by a dedicated API rather than the estimate autosave so
// both linking directions and the plan pins can't be clobbered by a concurrent
// rows/plan save.

// GET → all links for this estimate, each with its photo's display fields.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { data, error } = await supabase
    .from("estimate_photo_links")
    .select(
      "id, group_id, photo_id, plan_x, plan_y, created_at, deal_photos(id, storage_path, poster_path, caption, media_type, photo_type)"
    )
    .eq("estimate_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data ?? [] });
}

// POST → create (or reposition) a link. { groupId, photoId, planX?, planY? }
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    groupId?: unknown;
    photoId?: unknown;
    planX?: unknown;
    planY?: unknown;
  };
  const groupId = typeof body.groupId === "string" && body.groupId ? body.groupId : null;
  const photoId = typeof body.photoId === "number" ? body.photoId : Number(body.photoId);
  if (!groupId || !Number.isFinite(photoId)) {
    return NextResponse.json({ error: "groupId and photoId are required" }, { status: 400 });
  }
  const planX = typeof body.planX === "number" ? body.planX : null;
  const planY = typeof body.planY === "number" ? body.planY : null;

  const { data, error } = await supabase
    .from("estimate_photo_links")
    .upsert(
      { estimate_id: id, group_id: groupId, photo_id: photoId, plan_x: planX, plan_y: planY },
      { onConflict: "estimate_id,group_id,photo_id" }
    )
    .select("id, group_id, photo_id, plan_x, plan_y, created_at, deal_photos(id, storage_path, poster_path, caption, media_type, photo_type)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data }, { status: 201 });
}

// PATCH → move a pin. { linkId, planX, planY }
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { linkId?: unknown; planX?: unknown; planY?: unknown };
  const linkId = typeof body.linkId === "number" ? body.linkId : Number(body.linkId);
  if (!Number.isFinite(linkId)) return NextResponse.json({ error: "linkId is required" }, { status: 400 });
  const planX = typeof body.planX === "number" ? body.planX : null;
  const planY = typeof body.planY === "number" ? body.planY : null;

  const { data, error } = await supabase
    .from("estimate_photo_links")
    .update({ plan_x: planX, plan_y: planY })
    .eq("id", linkId)
    .eq("estimate_id", id)
    .select("id, group_id, photo_id, plan_x, plan_y")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data });
}

// DELETE → remove a link. { linkId } or { groupId, photoId }
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    linkId?: unknown;
    groupId?: unknown;
    photoId?: unknown;
  };
  let query = supabase.from("estimate_photo_links").delete().eq("estimate_id", id);
  if (typeof body.linkId === "number" || Number.isFinite(Number(body.linkId))) {
    query = query.eq("id", Number(body.linkId));
  } else if (typeof body.groupId === "string" && body.groupId && (typeof body.photoId === "number" || Number.isFinite(Number(body.photoId)))) {
    query = query.eq("group_id", body.groupId).eq("photo_id", Number(body.photoId));
  } else {
    return NextResponse.json({ error: "linkId or (groupId, photoId) is required" }, { status: 400 });
  }
  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
