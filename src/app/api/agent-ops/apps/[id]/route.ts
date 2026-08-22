import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { APP_STATUSES, type App, type AppStatus } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });
    update.name = name;
  }
  if (typeof body.summary === "string") update.summary = body.summary.trim();
  if (typeof body.repo === "string") update.repo = body.repo.trim() || null;
  if (typeof body.live_url === "string") update.live_url = body.live_url.trim() || null;
  if (typeof body.status === "string") {
    if (!APP_STATUSES.includes(body.status as AppStatus)) {
      return NextResponse.json({ error: `Unknown status "${body.status}"` }, { status: 400 });
    }
    update.status = body.status;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  // The slug is left alone on rename — it is the app's URL, and tidying a name
  // should not break a link someone saved.
  const { data, error } = await supabase.from("apps").update(update).eq("id", id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No such app" }, { status: 404 });
  return NextResponse.json({ app: data as App });
}
