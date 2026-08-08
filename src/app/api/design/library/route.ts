import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { safeExtension } from "@/lib/storagePaths";
import {
  PP_LIBRARY_BUCKET,
  ppLibraryUrl,
  isLibraryKind,
  type LibraryItem,
  type LibraryItemData,
} from "@/lib/design/library";

// The design stamp/plan-symbol library. Both libraries live in one table keyed
// by `kind`. GET returns every row (both kinds); the client filters. POST
// creates one item: the image is uploaded to the pp-library bucket and the row
// keeps only image_path. Item ids are client-generated ('custom-...'/'plan-...').

export async function GET() {
  const { data, error } = await supabase
    .from("pp_library_items")
    .select("id, kind, data, image_path")
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items: LibraryItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as LibraryItem["kind"],
    data: (row.data ?? {}) as LibraryItemData,
    image_path: (row.image_path as string | null) ?? null,
    imageUrl: row.image_path ? ppLibraryUrl(row.image_path as string) : null,
  }));

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const id = form.get("id");
  const kind = form.get("kind");
  const dataRaw = form.get("data");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof kind !== "string" || !isLibraryKind(kind)) {
    return NextResponse.json({ error: "kind must be perspective-stamp or plan-symbol" }, { status: 400 });
  }

  let data: LibraryItemData;
  try {
    data = typeof dataRaw === "string" ? JSON.parse(dataRaw) : {};
  } catch {
    return NextResponse.json({ error: "data must be valid JSON" }, { status: 400 });
  }

  try {
    const ext = safeExtension(file.name, "png");
    const path = `${kind}/${id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PP_LIBRARY_BUCKET)
      .upload(path, file, { contentType: file.type || "image/png", upsert: true });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Next sort_order for this kind, so items keep their add order.
    const { data: maxRow } = await supabase
      .from("pp_library_items")
      .select("sort_order")
      .eq("kind", kind)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = (maxRow?.sort_order ?? -1) + 1;

    const { data: row, error } = await supabase
      .from("pp_library_items")
      .insert({ id, kind, data, image_path: path, sort_order: sortOrder })
      .select("id, kind, data, image_path")
      .single();

    if (error) {
      await supabase.storage.from(PP_LIBRARY_BUCKET).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const item: LibraryItem = {
      id: row.id as string,
      kind: row.kind as LibraryItem["kind"],
      data: (row.data ?? {}) as LibraryItemData,
      image_path: (row.image_path as string | null) ?? null,
      imageUrl: row.image_path ? ppLibraryUrl(row.image_path as string) : null,
    };

    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create library item" },
      { status: 500 }
    );
  }
}
