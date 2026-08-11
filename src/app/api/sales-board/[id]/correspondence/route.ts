import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_CORRESPONDENCE_BUCKET } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

const CHANNELS = ["call", "email", "text"] as const;

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // A JSON body logs a call/email/text touchpoint (no file). A multipart body
  // uploads a correspondence screenshot (the original behavior below).
  if ((req.headers.get("content-type") || "").includes("application/json")) {
    const body = (await req.json()) as { channel?: unknown };
    if (typeof body.channel !== "string" || !(CHANNELS as readonly string[]).includes(body.channel)) {
      return NextResponse.json({ error: "channel must be call, email, or text" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("deal_correspondence")
      .insert({ deal_id: Number(id), channel: body.channel })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ correspondence: data }, { status: 201 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only images (screenshots) are supported" }, { status: 400 });
  }

  const ext = safeExtension(file.name, "png");
  const path = `deal-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(DEAL_CORRESPONDENCE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("deal_correspondence")
    .insert({
      deal_id: Number(id),
      storage_path: path,
      // Pasted screenshots arrive with a generic generated name (the
      // browser gives clipboard blobs no filename of their own) — still
      // worth storing whatever came through when there is one.
      file_name: file.name || `pasted-${Date.now()}.${ext}`,
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(DEAL_CORRESPONDENCE_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ correspondence: data }, { status: 201 });
}
