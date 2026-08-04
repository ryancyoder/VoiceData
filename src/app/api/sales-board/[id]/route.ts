import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { STAGES, type DealInput } from "@/lib/salesBoard";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as Partial<DealInput>;

  if (body.stage && !STAGES.includes(body.stage)) {
    return NextResponse.json({ error: `Invalid stage "${body.stage}"` }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.deal_name !== undefined) updates.deal_name = body.deal_name.trim();
  if (body.company !== undefined) updates.company = body.company;
  if (body.contact_first_name !== undefined) updates.contact_first_name = body.contact_first_name;
  if (body.contact_last_name !== undefined) updates.contact_last_name = body.contact_last_name;
  if (body.contact_email !== undefined) updates.contact_email = body.contact_email;
  if (body.contact_phone !== undefined) updates.contact_phone = body.contact_phone;
  if (body.proposal_number !== undefined) updates.proposal_number = body.proposal_number;
  if (body.proposal_date !== undefined) updates.proposal_date = body.proposal_date;
  if (body.proposal_description !== undefined) updates.proposal_description = body.proposal_description;
  if (body.next_action !== undefined) updates.next_action = body.next_action;
  if (body.jobsite_address !== undefined) updates.jobsite_address = body.jobsite_address;
  if (body.value !== undefined) updates.value = body.value;
  if (body.stage !== undefined) updates.stage = body.stage;
  if (body.lost_at !== undefined) updates.lost_at = body.lost_at;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("Sales Board")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deal: data });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { error } = await supabase.from("Sales Board").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
