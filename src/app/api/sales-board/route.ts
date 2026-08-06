import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { STAGES, type DealInput } from "@/lib/salesBoard";
import { findOrCreateProperty } from "@/lib/properties";
import { upsertPropertyContact } from "@/lib/contacts";
import { mapRawDealEvents, DEAL_EVENTS_SELECT } from "@/lib/dealEvents";

export async function GET() {
  const { data, error } = await supabase
    .from("Sales Board")
    .select(DEAL_EVENTS_SELECT)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deals: mapRawDealEvents(data ?? []) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<DealInput>;

  if (!body.deal_name || !body.deal_name.trim()) {
    return NextResponse.json({ error: "deal_name is required" }, { status: 400 });
  }
  if (body.stage && !STAGES.includes(body.stage)) {
    return NextResponse.json({ error: `Invalid stage "${body.stage}"` }, { status: 400 });
  }

  const jobsiteAddress = body.jobsite_address?.trim() || null;
  let property = null;
  try {
    property = jobsiteAddress ? await findOrCreateProperty(jobsiteAddress) : null;
  } catch {
    // Property lookup/geocoding is best-effort — never block creating the deal.
  }

  const { data, error } = await supabase
    .from("Sales Board")
    .insert({
      deal_name: body.deal_name.trim(),
      company: body.company ?? null,
      proposal_number: body.proposal_number ?? null,
      proposal_date: body.proposal_date ?? null,
      proposal_description: body.proposal_description ?? null,
      next_action: body.next_action ?? null,
      appointment_date: body.appointment_date ?? null,
      jobsite_address: jobsiteAddress,
      aspire_link: body.aspire_link?.trim() || null,
      property_id: property?.id ?? null,
      latitude: property?.latitude ?? null,
      longitude: property?.longitude ?? null,
      geocoded_at: property?.geocoded_at ?? null,
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
  // to attach it to, since property resolution above is itself best-effort.
  if (property) {
    try {
      await upsertPropertyContact(property.id, {
        first_name: body.contact_first_name ?? null,
        last_name: body.contact_last_name ?? null,
        email: body.contact_email ?? null,
        phone: body.contact_phone ?? null,
      });
    } catch {
      /* contact save is best-effort — never block deal creation */
    }
  }

  // A brand-new deal has no events yet.
  return NextResponse.json({ deal: { ...data, events: [] } }, { status: 201 });
}
