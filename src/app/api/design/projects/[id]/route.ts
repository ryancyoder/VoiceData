import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  PP_DESIGNS_BUCKET,
  ppDesignUrl,
  IMAGE_FIELD_COLUMNS,
  IMAGE_FIELDS,
  type ProjectFull,
  type ProjectImageField,
} from "@/lib/design/project";

type RouteParams = { params: Promise<{ id: string }> };

const PATH_COLUMNS = Object.values(IMAGE_FIELD_COLUMNS);
const SELECT_COLUMNS = ["id", "name", "deal_id", "property_id", "event_id", "doc", ...PATH_COLUMNS].join(", ");

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { data: row, error } = await supabase
    .from("pp_projects")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const r = row as unknown as Record<string, unknown>;
  const images = {} as Record<ProjectImageField, string | null>;
  for (const field of IMAGE_FIELDS) {
    const path = r[IMAGE_FIELD_COLUMNS[field]] as string | null;
    images[field] = path ? ppDesignUrl(path) : null;
  }

  const project: ProjectFull = {
    id: r.id as string,
    name: r.name as string,
    deal_id: (r.deal_id as number | null) ?? null,
    property_id: (r.property_id as number | null) ?? null,
    event_id: (r.event_id as number | null) ?? null,
    doc: (r.doc ?? {}) as Record<string, unknown>,
    images,
  };

  return NextResponse.json({ project });
}

// Autosave: replaces the doc (and optionally the name). Deliberately never
// touches deal_id/property_id/event_id or the image paths, so a debounced
// autosave can't unlink a deal or clobber an image (images go through the
// image route). Mirrors the estimator editor's PUT.
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  let body: { doc?: Record<string, unknown>; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.doc || typeof body.doc !== "object") {
    return NextResponse.json({ error: "doc object is required" }, { status: 400 });
  }

  const update: Record<string, unknown> = { doc: body.doc, updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();

  const { data: row, error } = await supabase
    .from("pp_projects")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: row, error: fetchErr } = await supabase
    .from("pp_projects")
    .select(PATH_COLUMNS.join(", "))
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const { error: delErr } = await supabase.from("pp_projects").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Best-effort cleanup of every image this project owned.
  if (row) {
    const r = row as unknown as Record<string, unknown>;
    const paths = PATH_COLUMNS.map((c) => r[c] as string | null).filter((p): p is string => !!p);
    if (paths.length > 0) {
      await supabase.storage.from(PP_DESIGNS_BUCKET).remove(paths);
    }
  }

  return NextResponse.json({ ok: true });
}
