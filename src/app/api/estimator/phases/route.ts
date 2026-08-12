import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// The canonical production-phase sequence — the single source of truth for the
// estimator's phase list and order (sequence_stages, ordered). Kept tiny so the
// estimator can load it cheaply on mount.
export async function GET() {
  const { data, error } = await supabase
    .from("sequence_stages")
    .select("name, sort_order")
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ phases: data ?? [] });
}
