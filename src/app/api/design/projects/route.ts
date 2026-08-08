import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ppDesignUrl, type ProjectSummary } from "@/lib/design/project";

// The design project list. GET returns summaries (newest first) with a
// background thumbnail; POST creates a project, optionally seeded from a deal
// and/or with an initial doc (used by the deal-linkage flow and migration).

export async function GET() {
  const { data, error } = await supabase
    .from("pp_projects")
    .select("id, name, deal_id, property_id, event_id, updated_at, created_at, background_image_path")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const projects: ProjectSummary[] = (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    deal_id: (row.deal_id as number | null) ?? null,
    property_id: (row.property_id as number | null) ?? null,
    event_id: (row.event_id as number | null) ?? null,
    updated_at: row.updated_at as string,
    created_at: row.created_at as string,
    thumbnailUrl: row.background_image_path ? ppDesignUrl(row.background_image_path as string) : null,
  }));

  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    deal_id?: number | null;
    property_id?: number | null;
    event_id?: number | null;
    doc?: Record<string, unknown>;
  } = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body → blank project
  }

  const insert: Record<string, unknown> = {
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled design",
    doc: body.doc && typeof body.doc === "object" ? body.doc : {},
  };
  if (typeof body.deal_id === "number") insert.deal_id = body.deal_id;
  if (typeof body.property_id === "number") insert.property_id = body.property_id;
  if (typeof body.event_id === "number") insert.event_id = body.event_id;

  const { data, error } = await supabase
    .from("pp_projects")
    .insert(insert)
    .select("id, name, deal_id, property_id, event_id, updated_at, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data }, { status: 201 });
}
