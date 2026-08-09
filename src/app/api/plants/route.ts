import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { Plant } from "@/lib/plants";

// Server-side search / filter / pagination over the plants reference catalog
// (1,900+ rows), so the client never loads the whole table.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const category = sp.get("category");
  const sun = sp.get("sun");
  const moisture = sp.get("moisture");
  const native = sp.get("native") === "1";
  const deer = sp.get("deer") === "1";
  const evergreen = sp.get("evergreen") === "1";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("plants").select("*", { count: "exact" });

  if (q) {
    // Strip characters that would break the PostgREST or() filter grammar.
    const safe = q.replace(/[,%()*\\]/g, " ").trim();
    if (safe) {
      query = query.or(`botanical.ilike.%${safe}%,common.ilike.%${safe}%,genus.ilike.%${safe}%`);
    }
  }
  if (category) query = query.eq("category", category);
  // Drill into a species album. Empty string means the null bucket.
  const genus = sp.get("genus");
  const species = sp.get("species");
  if (genus !== null) query = genus === "" ? query.is("genus", null) : query.eq("genus", genus);
  if (species !== null) query = species === "" ? query.is("species", null) : query.eq("species", species);
  if (sun) query = query.contains("sun", [sun]);
  if (moisture) query = query.contains("moisture", [moisture]);
  if (native) query = query.eq("native", true);
  if (deer) query = query.eq("deer_resistant", true);
  if (evergreen) query = query.eq("evergreen", true);

  // Sort: botanical name (default), or height ascending/descending with a
  // botanical tiebreaker. Nulls always sort last.
  const sort = sp.get("sort");
  if (sort === "height_asc") {
    query = query
      .order("height_in", { ascending: true, nullsFirst: false })
      .order("botanical", { ascending: true, nullsFirst: false });
  } else if (sort === "height_desc") {
    query = query
      .order("height_in", { ascending: false, nullsFirst: false })
      .order("botanical", { ascending: true, nullsFirst: false });
  } else {
    query = query.order("botanical", { ascending: true, nullsFirst: false });
  }
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    plants: (data ?? []) as Plant[],
    total: count ?? 0,
    page,
    pageSize,
  });
}
