import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { PLANT_IMAGES_BUCKET } from "@/lib/plants";
import { fetchCombination } from "@/lib/combinationsServer";

type RouteParams = { params: Promise<{ id: string }> };

function isOwnUpload(image: string | null | undefined): boolean {
  return !!image && !image.includes("/") && image.startsWith("combo-");
}

function parsePlantIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .map((x) => (typeof x === "number" ? x : Number(String(x).trim())))
    .filter((n) => Number.isInteger(n));
  return Array.from(new Set(ids));
}

// GET /api/combinations/[id] — single combination with linked plants.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const combination = await fetchCombination(id);
  if (!combination) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ combination });
}

// PATCH /api/combinations/[id] — update title/notes and/or the linked plant set.
// Body: { title?, notes?, plantIds?: number[] }. When plantIds is present it
// replaces the whole set.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  let body: { title?: unknown; notes?: unknown; plantIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("title" in body) patch.title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
  if ("notes" in body) patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  const { data: row, error } = await supabase
    .from("plant_combinations")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if ("plantIds" in body) {
    const plantIds = parsePlantIds(body.plantIds);
    const { error: delErr } = await supabase.from("plant_combination_plants").delete().eq("combination_id", id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    if (plantIds.length) {
      const links = plantIds.map((plant_id) => ({ combination_id: id, plant_id }));
      const { error: insErr } = await supabase.from("plant_combination_plants").insert(links);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }
  }

  const combination = await fetchCombination(id);
  return NextResponse.json({ combination });
}

// DELETE /api/combinations/[id] — remove the combination (join rows cascade)
// and its uploaded photo.
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: existing, error: fetchErr } = await supabase
    .from("plant_combinations")
    .select("image")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const { error } = await supabase.from("plant_combinations").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const image = (existing?.image as string | null) ?? null;
  if (isOwnUpload(image)) {
    await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([image as string]);
  }
  return NextResponse.json({ ok: true });
}
