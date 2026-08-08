import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// Kits are edited in place (rename, recolor, change takeoff unit). Changes
// arrive as a partial object; merge them into the stored `data` jsonb.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const changes = (await req.json()) as Record<string, unknown>;

  const { data: existing, error: fetchError } = await supabase
    .from("assembly_kits")
    .select("data")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "kit not found" }, { status: 404 });
  }

  const merged = { ...(existing.data as Record<string, unknown>), ...changes, id };

  const { data, error } = await supabase
    .from("assembly_kits")
    .update({ data: merged })
    .eq("id", id)
    .select("data")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ kit: data.data });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { error } = await supabase.from("assembly_kits").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
