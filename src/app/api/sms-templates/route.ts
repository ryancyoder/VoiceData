import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// Reusable text-message templates for the deal modal's Text button. Bodies may
// contain {first_name} / {last_name} / {proposal_number} tokens, filled in
// client-side per deal when a template is chosen.
export async function GET() {
  const { data, error } = await supabase
    .from("sms_templates")
    .select("id, name, body")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { name?: unknown; body?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const messageBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!name || !messageBody) {
    return NextResponse.json({ error: "name and body are required" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("sms_templates")
    .insert({ name, body: messageBody })
    .select("id, name, body")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template: data }, { status: 201 });
}
