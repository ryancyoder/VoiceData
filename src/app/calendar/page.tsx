import { supabase } from "@/lib/supabaseClient";
import type { DealPhoto, PropertyOption, Stage } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
import { PLANNING_BLOCK_COLUMNS, rowToBlock, type PlanningBlockRow } from "@/lib/planning/blocks";
import type { ForecastDeal, Placement } from "@/lib/planning/schedule";
import CalendarClient, { type CalendarEvent, type DealOption, type ProductionDeal } from "./CalendarClient";

export const dynamic = "force-dynamic";

// deal_photos are fetched as a plain one-to-many embed (`deal_photos(*)`),
// NOT with a nested `deal:"Sales Board"(...)` cross-table embed. deal_photos is
// a junction with FKs to events, "Sales Board", properties, AND tasks, and
// embedding another table THROUGH it makes PostgREST's relationship resolution
// ambiguous (the calendar 500'd once tasks became the 4th FK). Each photo's
// deal name/company/jobsite address is joined in code from the deals query
// instead — mirroring the plain-query pattern used in photos/page.tsx.
type RawPhoto = DealPhoto;

type RawEvent = {
  id: number;
  name: string | null;
  start_time: string;
  end_time: string;
  property_id: number | null;
  deal_id: number | null;
  event_type: EventType | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  deal_photos: RawPhoto[];
};

export default async function CalendarPage() {
  const [eventsRes, dealsRes, propertiesRes, ungroupedRes, blocksRes, stageDefaultsRes, placementsRes] = await Promise.all([
    supabase
      .from("events")
      .select("*, deal_photos(*)")
      .order("start_time", { ascending: true }),
    supabase
      .from("Sales Board")
      .select("id, deal_name, company, stage, lost_at, estimated_hours, proposal_date, created_at, start_date, end_date, properties(address, contacts(last_name))")
      .order("deal_name", { ascending: true }),
    supabase
      .from("properties")
      .select("id, address, contacts(last_name)")
      .order("address", { ascending: true }),
    supabase.from("deal_photos").select("id", { count: "exact", head: true }).is("event_id", null),
    supabase.from("planning_blocks").select(PLANNING_BLOCK_COLUMNS).order("created_at", { ascending: true }),
    supabase.from("stage_effort_defaults").select("stage, default_hours"),
    supabase.from("planning_placements").select("deal_id, block_id, date, position"),
  ]);

  if (eventsRes.error) {
    throw new Error(`Failed to load calendar: ${eventsRes.error.message}`);
  }
  if (blocksRes.error) {
    throw new Error(`Failed to load calendar: ${blocksRes.error.message}`);
  }
  if (dealsRes.error) {
    throw new Error(`Failed to load calendar: ${dealsRes.error.message}`);
  }
  if (propertiesRes.error) {
    throw new Error(`Failed to load calendar: ${propertiesRes.error.message}`);
  }

  const rawEvents = (eventsRes.data ?? []) as unknown as RawEvent[];
  const rawDeals = (dealsRes.data ?? []) as unknown as (Omit<DealOption, "contactLastName"> & {
    properties: { address: string | null; contacts: { last_name: string | null } | null } | null;
    estimated_hours: number | null;
    proposal_date: string | null;
    created_at: string | null;
    start_date: string | null;
    end_date: string | null;
  })[];
  const dealOptions: DealOption[] = rawDeals.map((d) => ({
    id: d.id,
    deal_name: d.deal_name,
    company: d.company,
    stage: d.stage,
    lost_at: d.lost_at,
    contactLastName: d.properties?.contacts?.last_name ?? null,
  }));
  const rawProperties = (propertiesRes.data ?? []) as unknown as {
    id: number;
    address: string;
    contacts: { last_name: string | null } | null;
  }[];
  const propertyOptions: PropertyOption[] = rawProperties.map((p) => ({
    id: p.id,
    address: p.address,
    contactLastName: p.contacts?.last_name ?? null,
  }));
  const ungeotaggedCount = ungroupedRes.count ?? 0;
  const planningBlocks = ((blocksRes.data ?? []) as unknown as PlanningBlockRow[]).map(rowToBlock);

  // Deals + stage defaults feed the same forecast the /forecast view uses, so
  // the calendar can show which deals land in each block window.
  const forecastDeals: ForecastDeal[] = rawDeals
    .filter((d) => d.lost_at == null)
    .map((d) => ({
      id: d.id,
      name: d.deal_name,
      company: d.company,
      stage: d.stage as Stage,
      estimatedHours: d.estimated_hours != null ? Number(d.estimated_hours) : null,
      orderDate: d.proposal_date ?? ((d.created_at ?? "").slice(0, 10) || "9999-12-31"),
    }));
  // Active deals with a production window (start and/or stop day set) — plotted
  // as multi-day all-day bars at the top of the calendar.
  const productionDeals: ProductionDeal[] = rawDeals
    .filter((d) => d.lost_at == null && (d.start_date || d.end_date))
    .map((d) => ({
      id: d.id,
      name: d.deal_name,
      stage: d.stage as Stage,
      startDate: d.start_date,
      endDate: d.end_date,
    }));

  const stageDefaults: Record<string, number> = {};
  for (const row of stageDefaultsRes.data ?? []) stageDefaults[row.stage as string] = Number(row.default_hours);
  const forecastPlacements: Placement[] = (placementsRes.data ?? []).map((r) => ({
    dealId: r.deal_id as number,
    blockId: r.block_id as string | null,
    date: r.date as string,
    position: r.position as number,
  }));

  const dealOptionsById = new Map(dealOptions.map((d) => [d.id, d]));
  // Deal name/company/jobsite address by deal id — joined in code in place of
  // the old nested `deal:"Sales Board"(...)` embed on the events query.
  const dealInfoById = new Map(
    rawDeals.map(
      (d) =>
        [d.id, { deal_name: d.deal_name, company: d.company, jobsiteAddress: d.properties?.address ?? null }] as const
    )
  );

  const calendarEvents: CalendarEvent[] = rawEvents.map((event) => {
    const photos = event.deal_photos ?? [];
    // A video attached only to the event (no deal_id of its own) doesn't
    // contribute a deal here — but the event's own deal_id (set directly,
    // separate from any individual photo's deal_id) still should.
    const dealIdSet = new Set<number>();
    for (const p of photos) if (p.deal_id != null) dealIdSet.add(p.deal_id);
    if (event.deal_id != null) dealIdSet.add(event.deal_id);
    const dealIds = Array.from(dealIdSet);

    return {
      id: event.id,
      name: event.name,
      start: event.start_time,
      end: event.end_time,
      propertyId: event.property_id,
      dealId: event.deal_id,
      eventType: event.event_type,
      latitude: event.latitude,
      longitude: event.longitude,
      notes: event.notes,
      dealIds,
      photos: photos.map((p) => ({
        id: p.id,
        deal_id: p.deal_id,
        storage_path: p.storage_path,
        caption: p.caption,
        created_at: p.created_at,
        taken_at: p.taken_at,
        latitude: p.latitude,
        longitude: p.longitude,
        event_id: p.event_id,
        media_type: p.media_type,
        poster_path: p.poster_path,
        is_outlier: p.is_outlier,
      })),
      deals: dealIds.map((id) => {
        const info = dealInfoById.get(id);
        const fromOption = dealOptionsById.get(id);
        return {
          id,
          name: info?.deal_name ?? fromOption?.deal_name ?? `Deal #${id}`,
          company: info?.company ?? fromOption?.company ?? null,
          jobsiteAddress: info?.jobsiteAddress ?? null,
        };
      }),
    };
  });

  return (
    <CalendarClient
      events={calendarEvents}
      ungeotaggedCount={ungeotaggedCount}
      dealOptions={dealOptions}
      propertyOptions={propertyOptions}
      blocks={planningBlocks}
      forecastDeals={forecastDeals}
      stageDefaults={stageDefaults}
      forecastPlacements={forecastPlacements}
      productionDeals={productionDeals}
    />
  );
}
