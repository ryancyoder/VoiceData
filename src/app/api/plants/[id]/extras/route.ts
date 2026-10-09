import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { PLANT_IMAGES_BUCKET, type PlantExtra } from "@/lib/plants";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

// The photographs kept beside a cultivar's cover — fall colour, leaf detail, bark, habit.
// A cultivar is not one picture: the same shrub in October carries different information from
// the same shrub in June, and a leaf close-up answers what a habit shot cannot.
//
// These live in plant_images with status 'extra'. That table has RLS on and no policies, so it
// is readable only through server code holding the service-role key — which is why this is a
// route rather than a query from the browser.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("plant_images")
    .select("id,caption,source,credit,storage_path,width,height,source_url,created_at")
    .eq("plant_id", plantId)
    .eq("status", "extra")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ extras: (data ?? []) as PlantExtra[] });
}

// Keep a photograph beside the cover, from the app.
//
// Until now an extra could only be created at the workstation: `plantpix review`
// offers what a harvest found and `E` keeps one. That is the right tool for
// judging a stranger's photograph against the cover, but it cannot help with the
// picture taken ten minutes ago on site — the one that is worth keeping precisely
// because nobody else has it.
//
// Deliberately NOT the cover. The cover answers "what is this plant"; an extra
// answers a narrower question (fall colour, bark, habit, how it actually looks in
// year three) and the caption is what makes it worth looking at. Replacing the
// cover is still /api/plants/<id>/image, and it still overwrites.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const caption = ((form.get("caption") as string | null) ?? "").trim().slice(0, 300) || null;
  const dim = (key: string) => {
    const n = Number(form.get(key));
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  // The plant has to exist: plant_images.plant_id is a foreign key, and a
  // clear 404 beats a constraint violation surfacing as a 500.
  const { data: plant, error: plantErr } = await supabase
    .from("plants")
    .select("id")
    .eq("id", plantId)
    .maybeSingle();
  if (plantErr) {
    return NextResponse.json({ error: plantErr.message }, { status: 500 });
  }
  if (!plant) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Flat, at the bucket root. plantImageUrl() keeps only the basename of
  // whatever it is given and rebuilds the path, so an object in a subfolder
  // 404s and the thumbnail silently falls back to a placeholder.
  const filename = `extra-${plantId}-${Date.now()}.${safeExtension(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(PLANT_IMAGES_BUCKET)
    .upload(filename, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: row, error } = await supabase
    .from("plant_images")
    .insert({
      plant_id: plantId,
      status: "extra",
      source: "upload",
      caption,
      storage_path: filename,
      width: dim("width"),
      height: dim("height"),
      bytes: file.size || null,
      // His own photograph of this row's plant is cultivar-level evidence by
      // construction — he chose the card he was standing on.
      match_kind: "cultivar",
      notes: "uploaded from Plant Reference",
      reviewed_at: new Date().toISOString(),
    })
    .select("id,caption,source,credit,storage_path,width,height,source_url,created_at")
    .maybeSingle();

  if (error || !row) {
    // Do not leave an orphan object behind a failed insert.
    await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([filename]);
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  return NextResponse.json({ extra: row as PlantExtra }, { status: 201 });
}

// Drop one extra. Anything you can add from the app you must be able to take
// back from the app, or a mis-filed photograph becomes permanent.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  const imageId = Number(new URL(req.url).searchParams.get("imageId"));
  if (!Number.isInteger(plantId) || !Number.isInteger(imageId)) {
    return NextResponse.json({ error: "invalid plant or image id" }, { status: 400 });
  }

  // Scope the lookup to this plant and to extras, so this cannot be used to
  // delete a cover or another plant's row by guessing an id.
  const { data: row, error: findErr } = await supabase
    .from("plant_images")
    .select("id,storage_path")
    .eq("id", imageId)
    .eq("plant_id", plantId)
    .eq("status", "extra")
    .maybeSingle();
  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { error } = await supabase.from("plant_images").delete().eq("id", imageId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Only reclaim the object if we put it there and nothing else points at it.
  // A harvested photograph can legitimately be shared by several rows (the same
  // file appears against both a species and one of its cultivars), and deleting
  // it would blank a card elsewhere.
  const path = row.storage_path as string | null;
  if (path && path.startsWith("extra-")) {
    const { count } = await supabase
      .from("plant_images")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", path);
    if (!count) {
      await supabase.storage.from(PLANT_IMAGES_BUCKET).remove([path]);
    }
  }

  return NextResponse.json({ ok: true });
}
