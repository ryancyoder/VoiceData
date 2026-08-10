import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { STAGES, SITE_PLAN_IMAGE_TYPE, type DealInput, type DealPhoto } from "@/lib/salesBoard";
import { upsertPropertyContact } from "@/lib/contacts";
import { mapRawDealEvents, DEAL_EVENTS_SELECT } from "@/lib/dealEvents";

export async function GET() {
  const [dealsRes, nextActionsRes, sitePlansRes] = await Promise.all([
    supabase.from("Sales Board").select(DEAL_EVENTS_SELECT).order("created_at", { ascending: true }),
    supabase.from("tasks").select("deal_id, title").eq("is_next_action", true),
    supabase.from("deal_photos").select("*").eq("photo_type", SITE_PLAN_IMAGE_TYPE).order("created_at", { ascending: false }),
  ]);

  if (dealsRes.error) {
    return NextResponse.json({ error: dealsRes.error.message }, { status: 500 });
  }
  if (nextActionsRes.error) {
    return NextResponse.json({ error: nextActionsRes.error.message }, { status: 500 });
  }
  if (sitePlansRes.error) {
    return NextResponse.json({ error: sitePlansRes.error.message }, { status: 500 });
  }

  const nextActionByDeal = new Map<number, string>();
  for (const row of (nextActionsRes.data ?? []) as { deal_id: number | null; title: string }[]) {
    if (row.deal_id != null) nextActionByDeal.set(row.deal_id, row.title);
  }

  const sitePlanByDeal = new Map<number, DealPhoto[]>();
  for (const photo of (sitePlansRes.data ?? []) as DealPhoto[]) {
    if (photo.deal_id != null) {
      const list = sitePlanByDeal.get(photo.deal_id) ?? [];
      list.push(photo);
      sitePlanByDeal.set(photo.deal_id, list);
    }
  }

  return NextResponse.json({ deals: mapRawDealEvents(dealsRes.data ?? [], nextActionByDeal, sitePlanByDeal) });
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
      rfp_date: body.rfp_date ?? null,
      won_date: body.won_date ?? null,
      start_date: body.start_date ?? null,
      end_date: body.end_date ?? null,
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

  // Seeds this deal's timeline with its starting stage — best-effort, never
  // blocks deal creation on failure.
  try {
    await supabase.from("deal_stage_history").insert({ deal_id: data.id, stage: data.stage });
  } catch {
    /* stage history is supplementary — the deal itself is already saved */
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

  // A brand-new deal has no events, photos, attachments, or correspondence yet.
  return NextResponse.json(
    { deal: { ...data, events: [], site_plan_photos: [], attachments: [], correspondence: [] } },
    { status: 201 }
  );
}
