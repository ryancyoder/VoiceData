import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { PlantExtra } from "@/lib/plants";

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
