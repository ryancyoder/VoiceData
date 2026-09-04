import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { Plant } from "@/lib/plants";

type RouteParams = { params: Promise<{ id: string }> };

// Star (or unstar) a cultivar as its species' choice. Starring one first clears
// the flag on every sibling in the same genus+species, so a species always has
// at most one choice — the cultivar whose photo becomes the album cover and
// which represents the group.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }

  let body: { is_choice?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const isChoice = Boolean(body.is_choice);

  const { data: plant, error: loadError } = await supabase
    .from("plants")
    .select("id, genus, species")
    .eq("id", plantId)
    .maybeSingle();
  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!plant) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (isChoice) {
    // Clear the whole species group first (this row included), then set this
    // one. null genus/species is its own group — mirrors plant_albums grouping.
    let clear = supabase.from("plants").update({ is_choice: false }).eq("is_choice", true);
    clear = plant.genus == null ? clear.is("genus", null) : clear.eq("genus", plant.genus);
    clear = plant.species == null ? clear.is("species", null) : clear.eq("species", plant.species);
    const { error: clearError } = await clear;
    if (clearError) {
      return NextResponse.json({ error: clearError.message }, { status: 500 });
    }
  }

  const { data: row, error } = await supabase
    .from("plants")
    .update({ is_choice: isChoice })
    .eq("id", plantId)
    .select("*")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ plant: row as Plant });
}
