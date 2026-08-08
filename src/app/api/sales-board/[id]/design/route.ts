import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { ppDesignUrl } from "@/lib/design/project";

type RouteParams = { params: Promise<{ id: string }> };

// A deal can have many designs (pp_projects.deal_id is a plain FK). GET lists
// them (newest first) with a thumbnail; POST creates one prefilled from the
// deal and returns its id so the DealModal can navigate straight into it.

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("pp_projects")
    .select("id, name, updated_at, background_image_path, render_path")
    .eq("deal_id", Number(id))
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const designs = (data ?? []).map((row) => {
    // Prefer the rendered preview, falling back to the background photo.
    const thumbPath = (row.render_path as string | null) ?? (row.background_image_path as string | null);
    return {
      id: row.id as string,
      name: row.name as string,
      updated_at: row.updated_at as string,
      thumbnailUrl: thumbPath ? ppDesignUrl(thumbPath) : null,
    };
  });

  return NextResponse.json({ designs });
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);

  const { data: deal, error: dealError } = await supabase
    .from("Sales Board")
    .select("deal_name, property_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealError) {
    return NextResponse.json({ error: dealError.message }, { status: 500 });
  }
  if (!deal) {
    return NextResponse.json({ error: "deal not found" }, { status: 404 });
  }

  const name = deal.deal_name ? `${deal.deal_name} — design` : "Untitled design";

  const { data: created, error: createError } = await supabase
    .from("pp_projects")
    .insert({
      deal_id: dealId,
      property_id: deal.property_id ?? null,
      name,
      doc: {},
    })
    .select("id")
    .single();

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }

  return NextResponse.json({ id: created.id }, { status: 201 });
}
