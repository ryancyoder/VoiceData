import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ppLibraryUrl, type LibraryItem, type LibraryItemData } from "@/lib/design/library";

// Design library items (perspective stamps / 2D plan symbols) linked to any
// plant in a given genus+species album, via data.referencePlantId. Powers the
// "Design symbols" section inside a drilled-into Plant Reference album.
interface Row {
  id: string;
  kind: string;
  data: LibraryItemData | null;
  image_path: string | null;
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const genus = sp.get("genus");
  const species = sp.get("species");

  const { data, error } = await supabase.rpc("library_items_for_species", {
    p_genus: genus,
    p_species: species,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items: LibraryItem[] = ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    kind: row.kind as LibraryItem["kind"],
    data: (row.data ?? {}) as LibraryItemData,
    image_path: row.image_path ?? null,
    imageUrl: row.image_path ? ppLibraryUrl(row.image_path) : null,
  }));

  return NextResponse.json({ items });
}
