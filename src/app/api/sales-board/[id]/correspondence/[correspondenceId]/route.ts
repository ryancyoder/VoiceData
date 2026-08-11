import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_CORRESPONDENCE_BUCKET } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string; correspondenceId: string }> };

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { correspondenceId } = await params;

  const { data: correspondence, error: fetchError } = await supabase
    .from("deal_correspondence")
    .select("storage_path")
    .eq("id", correspondenceId)
    .single();

  if (fetchError || !correspondence) {
    return NextResponse.json({ error: fetchError?.message || "Correspondence not found" }, { status: 404 });
  }

  const { error: deleteRowError } = await supabase.from("deal_correspondence").delete().eq("id", correspondenceId);
  if (deleteRowError) {
    return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  }

  // Channel touchpoints (call/email/text) have no file to remove.
  if (correspondence.storage_path) {
    await supabase.storage.from(DEAL_CORRESPONDENCE_BUCKET).remove([correspondence.storage_path]);
  }

  return NextResponse.json({ ok: true });
}
