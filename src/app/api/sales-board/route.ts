import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { STAGES, type DealInput } from "@/lib/salesBoard";

export async function GET() {
  const { data, error } = await supabase
    .from("Sales Board")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deals: data });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<DealInput>;

  if (!body.deal_name || !body.deal_name.trim()) {
    return NextResponse.json({ error: "deal_name is required" }, { status: 400 });
  }
  if (body.stage && !STAGES.includes(body.stage)) {
    return NextResponse.json({ error: `Invalid stage "${body.stage}"` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("Sales Board")
    .insert({
      deal_name: body.deal_name.trim(),
      company: body.company ?? null,
      contact_first_name: body.contact_first_name ?? null,
      contact_last_name: body.contact_last_name ?? null,
      contact_email: body.contact_email ?? null,
      contact_phone: body.contact_phone ?? null,
      proposal_number: body.proposal_number ?? null,
      proposal_date: body.proposal_date ?? null,
      proposal_description: body.proposal_description ?? null,
      next_action: body.next_action ?? null,
      jobsite_address: body.jobsite_address ?? null,
      value: body.value ?? null,
      stage: body.stage ?? "Lead",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deal: data }, { status: 201 });
}
