import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { Plant } from "@/lib/plants";
import { plantColumnsFromBody } from "@/lib/plantFields";

type RouteParams = { params: Promise<{ id: string }> };

// Fetch a single reference plant by id (used to open a plant's detail from a
// combination's linked-plant list).
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }
  const { data, error } = await supabase.from("plants").select("*").eq("id", plantId).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ plant: data as Plant });
}

// Update editable fields on a single reference plant. Only whitelisted columns
// are applied; last_updated is stamped server-side.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId)) {
    return NextResponse.json({ error: "invalid plant id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch = plantColumnsFromBody(body);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
  }
  patch.last_updated = new Date().toISOString();

  const { data: row, error } = await supabase
    .from("plants")
    .update(patch)
    .eq("id", plantId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ plant: row as Plant });
}
