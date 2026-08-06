import { supabase } from "@/lib/supabaseClient";
import type { Contact, Property } from "@/lib/salesBoard";
import PropertiesClient from "./PropertiesClient";

export const dynamic = "force-dynamic";

export interface PropertyRow extends Property {
  dealCount: number;
  eventCount: number;
}

type RawProperty = Omit<Property, "contact"> & { contacts: Contact | null };

export default async function PropertiesPage() {
  const [propertiesRes, dealsRes, eventsRes] = await Promise.all([
    supabase.from("properties").select("*, contacts(*)").order("address", { ascending: true }),
    supabase.from("Sales Board").select("property_id").not("property_id", "is", null),
    supabase.from("events").select("property_id").not("property_id", "is", null),
  ]);

  if (propertiesRes.error) {
    throw new Error(`Failed to load properties: ${propertiesRes.error.message}`);
  }
  if (dealsRes.error) {
    throw new Error(`Failed to load properties: ${dealsRes.error.message}`);
  }
  if (eventsRes.error) {
    throw new Error(`Failed to load properties: ${eventsRes.error.message}`);
  }

  const dealCounts = new Map<number, number>();
  for (const row of (dealsRes.data ?? []) as { property_id: number }[]) {
    dealCounts.set(row.property_id, (dealCounts.get(row.property_id) ?? 0) + 1);
  }
  const eventCounts = new Map<number, number>();
  for (const row of (eventsRes.data ?? []) as { property_id: number }[]) {
    eventCounts.set(row.property_id, (eventCounts.get(row.property_id) ?? 0) + 1);
  }

  const rawProperties = (propertiesRes.data ?? []) as unknown as RawProperty[];
  const properties: PropertyRow[] = rawProperties.map((p) => {
    const { contacts, ...rest } = p;
    return {
      ...rest,
      contact: contacts ?? null,
      dealCount: dealCounts.get(p.id) ?? 0,
      eventCount: eventCounts.get(p.id) ?? 0,
    };
  });

  return <PropertiesClient properties={properties} />;
}
