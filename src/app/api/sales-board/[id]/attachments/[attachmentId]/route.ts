import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_ATTACHMENTS_BUCKET } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string; attachmentId: string }> };

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { attachmentId } = await params;

  const { data: attachment, error: fetchError } = await supabase
    .from("deal_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .single();

  if (fetchError || !attachment) {
    return NextResponse.json({ error: fetchError?.message || "Attachment not found" }, { status: 404 });
  }

  const { error: deleteRowError } = await supabase.from("deal_attachments").delete().eq("id", attachmentId);
  if (deleteRowError) {
    return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  }

  await supabase.storage.from(DEAL_ATTACHMENTS_BUCKET).remove([attachment.storage_path]);

  return NextResponse.json({ ok: true });
}
