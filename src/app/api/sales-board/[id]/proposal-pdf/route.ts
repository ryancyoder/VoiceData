import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { DEAL_DOCUMENTS_BUCKET } from "@/lib/salesBoard";
import { safeExtension } from "@/lib/storagePaths";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("Sales Board")
    .select("proposal_pdf_path")
    .eq("id", id)
    .single();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 404 });
  }

  const ext = safeExtension(file.name, "pdf");
  const path = `deal-${id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(DEAL_DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || "application/pdf" });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("Sales Board")
    .update({ proposal_pdf_path: path })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    await supabase.storage.from(DEAL_DOCUMENTS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Replacing an existing proposal — the old file is now dead weight.
  if (existing.proposal_pdf_path) {
    await supabase.storage.from(DEAL_DOCUMENTS_BUCKET).remove([existing.proposal_pdf_path]);
  }

  return NextResponse.json({ deal: data });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: existing, error: existingError } = await supabase
    .from("Sales Board")
    .select("proposal_pdf_path")
    .eq("id", id)
    .single();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 404 });
  }
  if (!existing.proposal_pdf_path) {
    return NextResponse.json({ error: "No proposal PDF to remove" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("Sales Board")
    .update({ proposal_pdf_path: null })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.storage.from(DEAL_DOCUMENTS_BUCKET).remove([existing.proposal_pdf_path]);

  return NextResponse.json({ deal: data });
}
