import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// Assembly kits: `data` jsonb holds the full frontend (camelCase) kit,
// including its client-generated id and createdAt.

export async function GET() {
  const { data, error } = await supabase
    .from("assembly_kits")
    .select("data")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ kits: (data ?? []).map((row) => row.data) });
}

interface Kit {
  id: string;
  [key: string]: unknown;
}

export async function POST(req: NextRequest) {
  const kit = (await req.json()) as Kit;

  if (!kit || typeof kit.id !== "string" || !kit.id) {
    return NextResponse.json({ error: "kit needs a string id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("assembly_kits")
    .insert({ id: kit.id, data: kit })
    .select("data")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ kit: data.data }, { status: 201 });
}
