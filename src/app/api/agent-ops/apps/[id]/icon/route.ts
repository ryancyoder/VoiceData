import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { findAppIcon, toDataUrl } from "@/lib/appIcon";
import type { App } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

// Fetch the app's home-screen icon and store it. With a url in the body, that
// image is used directly; otherwise the app's live site is searched.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };

  const appRes = await supabase.from("apps").select("*").eq("id", id).maybeSingle();
  if (appRes.error) return NextResponse.json({ error: appRes.error.message }, { status: 500 });
  const app = appRes.data as App | null;
  if (!app) return NextResponse.json({ error: "No such app" }, { status: 404 });

  const given = typeof body.url === "string" ? body.url.trim() : "";
  let icon: { dataUrl: string; source: string } | null = null;

  if (given) {
    const dataUrl = given.startsWith("data:") ? given : await toDataUrl(given);
    if (!dataUrl) {
      return NextResponse.json({ error: "That URL did not return an image" }, { status: 400 });
    }
    icon = { dataUrl, source: "by hand" };
  } else {
    if (!app.live_url) {
      return NextResponse.json(
        { error: "No live URL to look at — add one, or paste an image URL" },
        { status: 400 }
      );
    }
    const hunt = await findAppIcon(app.live_url);
    if (!hunt.ok) {
      return NextResponse.json(
        { error: `${hunt.reason}. Paste an image URL instead.` },
        { status: 404 }
      );
    }
    icon = { dataUrl: hunt.dataUrl, source: hunt.source };
  }

  const { data, error } = await supabase
    .from("apps")
    .update({ icon_url: icon.dataUrl, icon_source: icon.source })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ app: data as App });
}

// Forget an icon without touching anything else about the app.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { data, error } = await supabase
    .from("apps")
    .update({ icon_url: null, icon_source: null })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No such app" }, { status: 404 });
  return NextResponse.json({ app: data as App });
}
