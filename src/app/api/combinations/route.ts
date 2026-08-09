import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { PLANT_IMAGES_BUCKET } from "@/lib/plants";
import { safeExtension } from "@/lib/storagePaths";
import { fetchCombination } from "@/lib/combinationsServer";
import type { Combination, CombinationPlant } from "@/lib/combinations";

// Shape returned by the combinations_list RPC row.
interface ComboRow {
  id: string;
  title: string | null;
  notes: string | null;
  image: string | null;
  created_at: string;
  updated_at: string;
  plants: CombinationPlant[] | null;
}

function parsePlantIds(raw: unknown): number[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = raw.split(",");
    }
  }
  if (!Array.isArray(arr)) return [];
  const ids = arr
    .map((x) => (typeof x === "number" ? x : Number(String(x).trim())))
    .filter((n) => Number.isInteger(n));
  return Array.from(new Set(ids));
}

// GET /api/combinations                     → every combination
// GET /api/combinations?genus=&species=     → only those tied to that species
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const genus = sp.get("genus");
  const species = sp.get("species");
  const filter = genus !== null || species !== null;

  const { data, error } = await supabase.rpc("combinations_list", {
    p_genus: genus,
    p_species: species,
    p_filter: filter,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const combinations: Combination[] = ((data ?? []) as ComboRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes,
    image: r.image,
    created_at: r.created_at,
    updated_at: r.updated_at,
    plants: r.plants ?? [],
  }));
  return NextResponse.json({ combinations });
}

// POST /api/combinations — create a combination (multipart: file, title, notes,
// plantIds JSON). The photo goes to the plant-images bucket as combo-<uuid>.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const title = form.get("title");
  const notes = form.get("notes");
  const plantIds = parsePlantIds(form.get("plantIds"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const ext = safeExtension(file.name, "jpg");
  const filename = `combo-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PLANT_IMAGES_BUCKET)
    .upload(filename, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: row, error } = await supabase
    .from("plant_combinations")
    .insert({
      title: typeof title === "string" && title.trim() ? title.trim() : null,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
      image: filename,
    })
    .select("id")
    .single();
  if (error || !row) {
    await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([filename]);
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  const id = row.id as string;
  if (plantIds.length) {
    const links = plantIds.map((plant_id) => ({ combination_id: id, plant_id }));
    const { error: linkErr } = await supabase.from("plant_combination_plants").insert(links);
    if (linkErr) {
      // Roll back the row + image so we don't leave an orphan.
      await supabase.from("plant_combinations").delete().eq("id", id);
      await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([filename]);
      return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }
  }

  const combination = await fetchCombination(id);
  return NextResponse.json({ combination }, { status: 201 });
}
