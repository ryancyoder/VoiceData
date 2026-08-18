import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { STAGES, type DealInput } from "@/lib/salesBoard";
import { upsertPropertyContact } from "@/lib/contacts";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as Partial<DealInput>;

  if (body.stage && !STAGES.includes(body.stage)) {
    return NextResponse.json({ error: `Invalid stage "${body.stage}"` }, { status: 400 });
  }

  const contactProvided =
    body.contact_first_name !== undefined ||
    body.contact_last_name !== undefined ||
    body.contact_email !== undefined ||
    body.contact_phone !== undefined;

  const updates: Record<string, unknown> = {};
  if (body.deal_name !== undefined) updates.deal_name = body.deal_name.trim();
  if (body.company !== undefined) updates.company = body.company;
  if (body.proposal_number !== undefined) updates.proposal_number = body.proposal_number;
  if (body.proposal_date !== undefined) updates.proposal_date = body.proposal_date;
  if (body.proposal_description !== undefined) updates.proposal_description = body.proposal_description;
  if (body.appointment_date !== undefined) updates.appointment_date = body.appointment_date;
  if (body.rfp_date !== undefined) updates.rfp_date = body.rfp_date;
  if (body.won_date !== undefined) updates.won_date = body.won_date;
  if (body.invoiced_date !== undefined) updates.invoiced_date = body.invoiced_date;
  if (body.paid_date !== undefined) updates.paid_date = body.paid_date;
  if (body.start_date !== undefined) updates.start_date = body.start_date;
  if (body.end_date !== undefined) updates.end_date = body.end_date;
  if (body.aspire_link !== undefined) updates.aspire_link = body.aspire_link?.trim() || null;
  if (body.opportunity_link !== undefined) updates.opportunity_link = body.opportunity_link?.trim() || null;
  if (body.value !== undefined) updates.value = body.value;
  if (body.stage !== undefined) updates.stage = body.stage;
  if (body.flagged !== undefined) updates.flagged = body.flagged;
  // Setting/clearing lost_at automatically flips the generated `status` column
  // (Closed when lost, else by stage) — see the status generation expression —
  // so a lost deal reads as Closed everywhere, not only where lost_at is checked.
  if (body.lost_at !== undefined) updates.lost_at = body.lost_at;

  if (Object.keys(updates).length === 0 && !contactProvided) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  // Resolved once, and reused for the contact save below — a deal's
  // contact is saved as its property's primary contact, never a deal
  // column, so it needs to know which property this deal points to.
  let resolvedPropertyId: number | null | undefined;
  if (body.property_id !== undefined) {
    updates.property_id = body.property_id;
    resolvedPropertyId = body.property_id;
  }

  if (contactProvided && resolvedPropertyId === undefined) {
    const { data: existing, error: existingError } = await supabase
      .from("Sales Board")
      .select("property_id")
      .eq("id", id)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    resolvedPropertyId = existing?.property_id ?? null;
  }

  if (contactProvided && resolvedPropertyId == null) {
    return NextResponse.json({ error: "Add a jobsite address before setting a contact" }, { status: 400 });
  }

  let data: Record<string, unknown> | null = null;
  if (Object.keys(updates).length > 0) {
    const { data: updated, error } = await supabase
      .from("Sales Board")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    data = updated;
  }

  if (contactProvided && resolvedPropertyId != null) {
    try {
      await upsertPropertyContact(resolvedPropertyId, {
        first_name: body.contact_first_name ?? null,
        last_name: body.contact_last_name ?? null,
        email: body.contact_email ?? null,
        phone: body.contact_phone ?? null,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to save contact" },
        { status: 500 }
      );
    }
  }

  if (!data) {
    const { data: fetched, error: fetchError } = await supabase.from("Sales Board").select().eq("id", id).single();
    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    data = fetched;
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
