import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_ATTACHMENTS_BUCKET } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) {
    return NextResponse.json({ error: "Only images and PDFs are supported" }, { status: 400 });
  }

  const ext = safeExtension(file.name, isPdf ? "pdf" : "png");
  const path = `deal-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(DEAL_ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("deal_attachments")
    .insert({
      deal_id: Number(id),
      storage_path: path,
      // Pasted screenshots arrive with a generic generated name (the
      // browser gives clipboard blobs no filename of their own) — still
      // worth storing whatever came through so a real filename (e.g. a
      // vendor's own "receipt_4821.pdf") shows up when there is one.
      file_name: file.name || `pasted-${Date.now()}.${ext}`,
      kind: isPdf ? "pdf" : "image",
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(DEAL_ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attachment: data }, { status: 201 });
}
