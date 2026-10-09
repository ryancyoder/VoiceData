import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { Plant } from "@/lib/plants";
import { composeBotanical, plantColumnsFromBody } from "@/lib/plantFields";

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

// Add a cultivar to the library.
//
// The catalog arrived as an import and had no way to grow: a cultivar Ricci's
// started carrying could be photographed, specified and planted, and still not
// exist here. A row created from the album you are standing in inherits that
// album's genus and species, so the new cultivar lands inside it rather than
// orphaned in "All plants".
//
// Only the columns the editor can already change are accepted — the same
// whitelist the PATCH route uses, so create and edit cannot disagree about what
// is writable. The photograph is not part of this request: the row has to exist
// before anything can be filed against its id, so the client creates the plant
// first and posts the image to /api/plants/<id>/image second.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const row = plantColumnsFromBody(body);

  // A row with no name at all is unfindable and unmatchable - refuse it rather
  // than leave a blank card in the library.
  const named = ["genus", "cultivar", "common", "botanical"].some(
    (k) => typeof row[k] === "string" && (row[k] as string).trim(),
  );
  if (!named) {
    return NextResponse.json(
      { error: "a genus, cultivar, common name or botanical name is required" },
      { status: 400 },
    );
  }

  if (!row.botanical) {
    row.botanical = composeBotanical(
      (row.genus as string | null) ?? null,
      (row.species as string | null) ?? null,
      (row.cultivar as string | null) ?? null,
    );
  }
  row.last_updated = new Date().toISOString();

  const { data, error } = await supabase.from("plants").insert(row).select("*").maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "insert returned no row" }, { status: 500 });
  }
  return NextResponse.json({ plant: data as Plant }, { status: 201 });
}
