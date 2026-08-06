import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { STAGES, type DealInput } from "@/lib/salesBoard";
import { upsertPropertyContact } from "@/lib/contacts";
import { mapRawDealEvents, DEAL_EVENTS_SELECT } from "@/lib/dealEvents";

export async function GET() {
  const [dealsRes, nextActionsRes] = await Promise.all([
    supabase.from("Sales Board").select(DEAL_EVENTS_SELECT).order("created_at", { ascending: true }),
    supabase.from("tasks").select("deal_id, title").eq("is_next_action", true),
  ]);

  if (dealsRes.error) {
    return NextResponse.json({ error: dealsRes.error.message }, { status: 500 });
  }
  if (nextActionsRes.error) {
    return NextResponse.json({ error: nextActionsRes.error.message }, { status: 500 });
  }

  const nextActionByDeal = new Map<number, string>();
  for (const row of (nextActionsRes.data ?? []) as { deal_id: number | null; title: string }[]) {
    if (row.deal_id != null) nextActionByDeal.set(row.deal_id, row.title);
  }

  return NextResponse.json({ deals: mapRawDealEvents(dealsRes.data ?? [], nextActionByDeal) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<DealInput>;

  if (!body.deal_name || !body.deal_name.trim()) {
    return NextResponse.json({ error: "deal_name is required" }, { status: 400 });
  }
  if (body.stage && !STAGES.includes(body.stage)) {
    return NextResponse.json({ error: `Invalid stage "${body.stage}"` }, { status: 400 });
  }

  const propertyId = body.property_id ?? null;

  const { data, error } = await supabase
    .from("Sales Board")
    .insert({
      deal_name: body.deal_name.trim(),
      company: body.company ?? null,
      proposal_number: body.proposal_number ?? null,
      proposal_date: body.proposal_date ?? null,
      proposal_description: body.proposal_description ?? null,
      appointment_date: body.appointment_date ?? null,
      aspire_link: body.aspire_link?.trim() || null,
      property_id: propertyId,
      value: body.value ?? null,
      stage: body.stage ?? "Lead",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A contact belongs to the property, not the deal — silently skipped
  // (rather than failing the whole deal creation) when there's no property
  // to attach it to.
  if (propertyId != null) {
    try {
      await upsertPropertyContact(propertyId, {
        first_name: body.contact_first_name ?? null,
        last_name: body.contact_last_name ?? null,
        email: body.contact_email ?? null,
        phone: body.contact_phone ?? null,
      });
    } catch {
      /* contact save is best-effort — never block deal creation */
    }
  }

  // A brand-new deal has no events or attachments yet.
  return NextResponse.json({ deal: { ...data, events: [], attachments: [] } }, { status: 201 });
}
