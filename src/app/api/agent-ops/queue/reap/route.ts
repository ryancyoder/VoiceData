import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

// Hand back every row whose lease has run out. Rows that still have attempts
// left go back to pending; those that are out of attempts are marked failed.
// The database function already does exactly this — the console just runs it,
// since nothing is on a schedule to.
export async function POST() {
  const { data, error } = await supabase.rpc("reap_expired_leases");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reaped: (data as number) ?? 0 });
}
