import { supabase } from "@/lib/supabaseClient";
import type { Contact, Property, Stage } from "@/lib/salesBoard";
import PropertiesClient from "./PropertiesClient";

export const dynamic = "force-dynamic";

export interface PropertyRow extends Property {
  dealCount: number;
  eventCount: number;
  // The distinct pipeline stages of this property's own deals — a property
  // can have more than one deal (a return client, a second project), so
  // this is a set of stages, not a single one. Used by the stage filter bar.
  dealStages: Stage[];
  // The latest appointment date across this property's deals (ISO YYYY-MM-DD),
  // or null. The APPOINTMENTS filter treats max >= today as "has an upcoming
  // appointment" — the client compares against the browser's local day.
  maxAppointmentDate: string | null;
}

type RawProperty = Omit<Property, "contact"> & { contacts: Contact | null };

export default async function PropertiesPage() {
  const [propertiesRes, dealsRes, eventsRes] = await Promise.all([
    supabase
      .from("properties")
      .select("*, contacts(*)")
      .order("last_name", { ascending: true, foreignTable: "contacts" })
      .order("address", { ascending: true }),
    supabase.from("Sales Board").select("property_id, stage, appointment_date").not("property_id", "is", null),
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
  const dealStagesByProperty = new Map<number, Set<Stage>>();
  const maxApptByProperty = new Map<number, string>();
  for (const row of (dealsRes.data ?? []) as { property_id: number; stage: Stage; appointment_date: string | null }[]) {
    dealCounts.set(row.property_id, (dealCounts.get(row.property_id) ?? 0) + 1);
    const stages = dealStagesByProperty.get(row.property_id) ?? new Set<Stage>();
    stages.add(row.stage);
    dealStagesByProperty.set(row.property_id, stages);
    if (row.appointment_date) {
      const cur = maxApptByProperty.get(row.property_id);
      // ISO YYYY-MM-DD sorts lexicographically, so string max = latest date.
      if (!cur || row.appointment_date > cur) maxApptByProperty.set(row.property_id, row.appointment_date);
    }
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
      dealStages: Array.from(dealStagesByProperty.get(p.id) ?? []),
      maxAppointmentDate: maxApptByProperty.get(p.id) ?? null,
    };
  });

  return <PropertiesClient properties={properties} />;
}
