import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// A lightweight index for the command palette — id/label/subtitle only,
// not the full nested rows /api/sales-board and /api/properties return.
// The record counts here are small enough (a single business's pipeline)
// that fetching everything once and filtering client-side, Spotlight-
// style, is simpler and feels faster than a debounced server search.
export async function GET() {
  const [dealsRes, propertiesRes, eventsRes, photosRes] = await Promise.all([
    supabase.from("Sales Board").select("id, deal_name, company, stage, lost_at, property_id").order("deal_name"),
    supabase.from("properties").select("id, address, contacts(first_name, last_name)").order("address"),
    supabase.from("events").select("id, property_id"),
    // Just the linkage columns needed to decide which property each photo's
    // album belongs to — not the full rows.
    supabase.from("deal_photos").select("property_id, deal_id, event_id"),
  ]);

  if (dealsRes.error) {
    return NextResponse.json({ error: dealsRes.error.message }, { status: 500 });
  }
  if (propertiesRes.error) {
    return NextResponse.json({ error: propertiesRes.error.message }, { status: 500 });
  }
  if (eventsRes.error) {
    return NextResponse.json({ error: eventsRes.error.message }, { status: 500 });
  }
  if (photosRes.error) {
    return NextResponse.json({ error: photosRes.error.message }, { status: 500 });
  }

  const deals = (dealsRes.data ?? []).map((d) => ({
    id: d.id,
    label: d.deal_name,
    subtitle: [d.company, d.lost_at ? "Lost" : d.stage].filter(Boolean).join(" · ") || null,
    property_id: d.property_id ?? null,
  }));

  const properties = (propertiesRes.data ?? []).map((p) => {
    const contact = p.contacts as unknown as { first_name: string | null; last_name: string | null } | null;
    const contactName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : "";
    return {
      id: p.id,
      label: p.address,
      subtitle: contactName || null,
      contactLastName: contact?.last_name ?? null,
    };
  });

  // Resolve which property each photo album belongs to, mirroring the Photos
  // page: an event photo belongs to the event's property, a site-plan photo to
  // its deal's property, and a general-reference photo to its own property_id.
  const eventProperty = new Map<number, number | null>();
  for (const e of eventsRes.data ?? []) eventProperty.set(e.id, e.property_id ?? null);
  const dealProperty = new Map<number, number | null>();
  for (const d of dealsRes.data ?? []) dealProperty.set(d.id, d.property_id ?? null);

  const propertiesWithPhotos = new Set<number>();
  for (const photo of photosRes.data ?? []) {
    let propertyId: number | null = null;
    if (photo.event_id != null && eventProperty.has(photo.event_id)) {
      propertyId = eventProperty.get(photo.event_id) ?? null;
    } else if (photo.deal_id != null && dealProperty.has(photo.deal_id)) {
      propertyId = dealProperty.get(photo.deal_id) ?? null;
    } else {
      propertyId = photo.property_id ?? null;
    }
    if (propertyId != null) propertiesWithPhotos.add(propertyId);
  }

  // Albums are just the properties that actually have photos, linking into the
  // Photos view rather than the properties page.
  const albums = properties.filter((p) => propertiesWithPhotos.has(p.id));

  return NextResponse.json({ deals, properties, albums });
}
