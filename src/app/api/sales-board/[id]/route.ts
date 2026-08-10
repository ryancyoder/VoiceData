import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { STAGES, type DealInput, type Stage } from "@/lib/salesBoard";
import { upsertPropertyContact } from "@/lib/contacts";
import type { MilestoneEventType } from "@/lib/events";

type RouteParams = { params: Promise<{ id: string }> };

// Only these stage transitions represent a deal-timeline milestone — the
// pipeline itself has more stages than the timeline cares to show. Moving
// into one of these creates a calendar event (event_type = the milestone),
// which is how the timeline's milestones get their dates; the rest of the
// pipeline's stages simply don't produce a timeline event.
const STAGE_TO_MILESTONE: Partial<Record<Stage, MilestoneEventType>> = {
  Sent: "Proposal Sent",
  Sold: "Sold",
  "Project Management": "Project Management",
  Invoiced: "Invoiced",
  "Paid in Full": "Paid in Full",
};

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
  if (body.start_date !== undefined) updates.start_date = body.start_date;
  if (body.end_date !== undefined) updates.end_date = body.end_date;
  if (body.aspire_link !== undefined) updates.aspire_link = body.aspire_link?.trim() || null;
  if (body.value !== undefined) updates.value = body.value;
  if (body.stage !== undefined) updates.stage = body.stage;
  if (body.lost_at !== undefined) updates.lost_at = body.lost_at;

  if (Object.keys(updates).length === 0 && !contactProvided) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  // Fetched up front (before the update overwrites it) so a milestone
  // event is only logged when the stage is actually changing — a PATCH
  // that re-sends the same stage shouldn't create a duplicate event.
  let previousStage: string | undefined;
  if (body.stage !== undefined) {
    const { data: existing, error: existingError } = await supabase
      .from("Sales Board")
      .select("stage")
      .eq("id", id)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    previousStage = existing?.stage;
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

  // A stage change that lands on one of the timeline's milestones is
  // logged as a calendar event (event_type = the milestone) — the deal
  // timeline reads these directly, so there's no separate stage-history
  // table to keep in sync.
  const milestone = body.stage !== undefined ? STAGE_TO_MILESTONE[body.stage] : undefined;
  if (milestone && body.stage !== previousStage) {
    try {
      const start = new Date();
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      // Named after the deal (not the milestone) so the calendar block
      // reads as "Smith Deal" — the milestone itself is already shown via
      // event_type's badge (e.g. "SOLD").
      const dealName = typeof data?.deal_name === "string" ? data.deal_name : milestone;
      await supabase.from("events").insert({
        deal_id: Number(id),
        name: dealName,
        event_type: milestone,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      });
    } catch {
      /* milestone event is supplementary — the stage change itself already saved */
    }
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
