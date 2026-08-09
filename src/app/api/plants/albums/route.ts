import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { PlantAlbum } from "@/lib/plants";

// The plants catalog grouped into species albums (genus + species). Grouping and
// pagination happen in the plant_albums() RPC so they're correct across the whole
// filtered set, not just one page.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const qRaw = (sp.get("q") ?? "").trim();
  const q = qRaw.replace(/[%_,()*\\]/g, " ").trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 50));
  const offset = (page - 1) * pageSize;

  const { data, error } = await supabase.rpc("plant_albums", {
    p_q: q || null,
    p_category: sp.get("category") || null,
    p_sun: sp.get("sun") || null,
    p_moisture: sp.get("moisture") || null,
    p_native: sp.get("native") === "1",
    p_deer: sp.get("deer") === "1",
    p_evergreen: sp.get("evergreen") === "1",
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as (PlantAlbum & { total_count: number })[];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const albums: PlantAlbum[] = rows.map((r) => ({
    album_key: r.album_key,
    genus: r.genus,
    species: r.species,
    common: r.common,
    category: r.category,
    cultivars: Number(r.cultivars),
    image: r.image,
  }));

  return NextResponse.json({ albums, total, page, pageSize });
}
