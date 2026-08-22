import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { APP_STATUSES, slugify, type App, type AppStatus } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase.from("apps").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ apps: (data ?? []) as App[] });
}

// "owner/name", which is what the repo column holds and what a GitHub URL is
// built from. A pasted github.com URL is accepted and reduced to that.
function normalizeRepo(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });

  const status = typeof body.status === "string" ? body.status : "active";
  if (!APP_STATUSES.includes(status as AppStatus)) {
    return NextResponse.json({ error: `Unknown status "${status}"` }, { status: 400 });
  }

  const insert = {
    slug: typeof body.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(name),
    name,
    repo: typeof body.repo === "string" && body.repo.trim() ? normalizeRepo(body.repo) : null,
    live_url: typeof body.live_url === "string" && body.live_url.trim() ? body.live_url.trim() : null,
    status,
    summary: typeof body.summary === "string" ? body.summary.trim() : "",
  };

  const { data, error } = await supabase.from("apps").insert(insert).select().single();
  if (error) {
    const taken = error.code === "23505";
    return NextResponse.json(
      { error: taken ? `There is already an app at /${insert.slug}` : error.message },
      { status: taken ? 409 : 500 }
    );
  }
  return NextResponse.json({ app: data as App }, { status: 201 });
}
