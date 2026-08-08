import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// A deal has at most one estimate (estimates.deal_id is unique). GET returns it
// (or null); POST creates it, prefilled from the deal, or returns the existing
// one so the button is idempotent.

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("estimates")
    .select("id, total")
    .eq("deal_id", Number(id))
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    estimate: data ? { id: data.id, total: data.total != null ? Number(data.total) : null } : null,
  });
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const dealId = Number(id);

  // Idempotent: if this deal already has an estimate, hand it back.
  const { data: existing, error: existingError } = await supabase
    .from("estimates")
    .select("id")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ id: existing.id, existed: true });
  }

  // Prefill from the deal and its property's primary contact.
  const { data: deal, error: dealError } = await supabase
    .from("Sales Board")
    .select("deal_name, property_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealError) {
    return NextResponse.json({ error: dealError.message }, { status: 500 });
  }
  if (!deal) {
    return NextResponse.json({ error: "deal not found" }, { status: 404 });
  }

  let clientName = "";
  if (deal.property_id != null) {
    const { data: property } = await supabase
      .from("properties")
      .select("primary_contact_id")
      .eq("id", deal.property_id)
      .maybeSingle();
    if (property?.primary_contact_id != null) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("first_name, last_name")
        .eq("id", property.primary_contact_id)
        .maybeSingle();
      if (contact) {
        clientName = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
      }
    }
  }

  const { data: created, error: createError } = await supabase
    .from("estimates")
    .insert({
      deal_id: dealId,
      property_id: deal.property_id ?? null,
      project_name: deal.deal_name ?? "",
      client_name: clientName,
      estimate_date: new Date().toISOString().split("T")[0],
      rows: [],
      plan: {},
    })
    .select("id")
    .single();

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }

  return NextResponse.json({ id: created.id, existed: false }, { status: 201 });
}
