import { supabase } from "@/lib/supabaseClient";
import type {
  SiteVisitContact,
  SiteVisitContext,
  SiteVisitDeal,
  SiteVisitEvent,
  SiteVisitPriorVisit,
  SiteVisitProperty,
  SiteVisitSiblingDeal,
  SiteVisitTask,
} from "@/lib/siteVisit";

// Assembles the live Supabase context a site-visit session is launched with.
// Everything here is read-only; the write-back path lives in siteVisitAgent.ts.

const DEALS_TABLE = "Sales Board";

const DEAL_COLUMNS =
  "id, deal_name, company, stage, value, proposal_number, proposal_description, appointment_date, rfp_date, start_date, end_date, property_id";

type RawEvent = {
  id: number;
  name: string | null;
  start_time: string;
  event_type: SiteVisitEvent["event_type"];
  deal_photos: { count: number }[] | null;
};

export class SiteVisitContextError extends Error {}

/**
 * Load everything a session needs about one deal. Throws SiteVisitContextError
 * when the deal doesn't exist; every other lookup degrades to empty rather than
 * failing the whole load, so a session can still start if (say) the site-visit
 * tables haven't been migrated on this project yet.
 */
export async function loadSiteVisitContext(dealId: number): Promise<SiteVisitContext> {
  const dealRes = await supabase.from(DEALS_TABLE).select(DEAL_COLUMNS).eq("id", dealId).maybeSingle();
  if (dealRes.error) throw new SiteVisitContextError(dealRes.error.message);
  if (!dealRes.data) throw new SiteVisitContextError(`No deal with id ${dealId}`);
  const deal = dealRes.data as unknown as SiteVisitDeal;

  let property: SiteVisitProperty | null = null;
  let contact: SiteVisitContact | null = null;
  if (deal.property_id != null) {
    const propRes = await supabase
      .from("properties")
      .select("id, address, latitude, longitude, primary_contact_id, contacts(id, first_name, last_name, email, phone)")
      .eq("id", deal.property_id)
      .maybeSingle();
    if (!propRes.error && propRes.data) {
      const row = propRes.data as unknown as SiteVisitProperty & { contacts: SiteVisitContact | null };
      const { contacts, ...rest } = row;
      property = rest;
      contact = contacts ?? null;
    }
  }

  // Events on the deal, newest first, with a photo count rather than the photos
  // themselves — the brief only ever mentions how many there were.
  const eventsRes = await supabase
    .from("events")
    .select("id, name, start_time, event_type, deal_photos(count)")
    .eq("deal_id", dealId)
    .order("start_time", { ascending: false })
    .limit(10);
  const events: SiteVisitEvent[] = eventsRes.error
    ? []
    : ((eventsRes.data ?? []) as unknown as RawEvent[]).map((e) => ({
        id: e.id,
        name: e.name,
        start_time: e.start_time,
        event_type: e.event_type,
        photo_count: e.deal_photos?.[0]?.count ?? 0,
      }));

  const transcriptRes = await supabase
    .from("deal_transcripts")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);
  const transcriptCount = transcriptRes.error ? 0 : (transcriptRes.count ?? 0);

  // Repeat customers: the other deals attached to the same property. This is
  // the history that makes a tile tap worth more than opening the deal record.
  let siblingDeals: SiteVisitSiblingDeal[] = [];
  if (deal.property_id != null) {
    const sibRes = await supabase
      .from(DEALS_TABLE)
      .select("id, deal_name, stage, value, won_date, proposal_description")
      .eq("property_id", deal.property_id)
      .neq("id", dealId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (!sibRes.error) siblingDeals = (sibRes.data ?? []) as unknown as SiteVisitSiblingDeal[];
  }

  const tasksRes = await supabase
    .from("tasks")
    .select("id, title, is_next_action")
    .eq("deal_id", dealId)
    .is("completed_at", null)
    .order("is_next_action", { ascending: false })
    .limit(10);
  const openTasks: SiteVisitTask[] = tasksRes.error ? [] : ((tasksRes.data ?? []) as SiteVisitTask[]);

  const visitsRes = await supabase
    .from("site_visit_sessions")
    .select("id, started_at, ended_at, summary")
    .eq("deal_id", dealId)
    .eq("status", "closed")
    .order("started_at", { ascending: false })
    .limit(5);
  const priorVisits: SiteVisitPriorVisit[] = visitsRes.error
    ? []
    : ((visitsRes.data ?? []) as SiteVisitPriorVisit[]);

  const priorAnswers = await loadPriorAnswers(dealId);

  return {
    deal,
    property,
    contact,
    events,
    transcriptCount,
    siblingDeals,
    priorVisits,
    openTasks,
    priorAnswers,
  };
}

/**
 * The most recent answer recorded for each checklist slug on this deal. Ordered
 * oldest-first so later answers overwrite earlier ones — a gap answered two
 * visits ago stays closed, and a re-answer supersedes it.
 */
export async function loadPriorAnswers(dealId: number): Promise<Record<string, string>> {
  const res = await supabase
    .from("site_visit_questions")
    .select("slug, answer, asked_at")
    .eq("deal_id", dealId)
    .eq("answered", true)
    .order("asked_at", { ascending: true })
    .limit(200);
  if (res.error) return {};
  const out: Record<string, string> = {};
  for (const row of (res.data ?? []) as { slug: string; answer: string | null }[]) {
    if (row.answer && row.answer.trim()) out[row.slug] = row.answer.trim();
  }
  return out;
}
