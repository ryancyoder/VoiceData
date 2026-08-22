import type { EventType } from "@/lib/events";

// ─── Context-aware tiles, Phase 1-2 ──────────────────────────────────────────
// A "site visit" is a voice session launched from a tile that already knows
// which deal it is about. Before a word is spoken the server loads that deal's
// live context out of Supabase (contact, property, scope, history, what past
// visits already established) and turns it into a system prompt.
//
// The point of the checklist below is NOT to march through every question every
// time. It is to work out which items the database already answers so the
// conversation can spend its time on the genuine gaps — and every gap filled by
// talking is a round trip back into Supabase, so the next visit starts with one
// fewer gap.

export const SITE_VISIT_TILE_KEY = "site-visit";

/** A logged question that no checklist item covers — the agent's own follow-up. */
export const AD_HOC_SLUG = "ad_hoc";

export interface SiteVisitDeal {
  id: number;
  deal_name: string;
  company: string | null;
  stage: string;
  value: number | null;
  proposal_number: string | null;
  proposal_description: string | null;
  appointment_date: string | null;
  rfp_date: string | null;
  start_date: string | null;
  end_date: string | null;
  property_id: number | null;
}

export interface SiteVisitContact {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface SiteVisitProperty {
  id: number;
  address: string;
  latitude: number | null;
  longitude: number | null;
  primary_contact_id: number | null;
}

export interface SiteVisitEvent {
  id: number;
  name: string | null;
  start_time: string;
  event_type: EventType | null;
  photo_count: number;
}

export interface SiteVisitSiblingDeal {
  id: number;
  deal_name: string;
  stage: string;
  value: number | null;
  won_date: string | null;
  proposal_description: string | null;
}

export interface SiteVisitPriorVisit {
  id: number;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

export interface SiteVisitTask {
  id: number;
  title: string;
  is_next_action: boolean;
}

/**
 * Everything a session is launched with. Assembled server-side by
 * `loadSiteVisitContext` (src/lib/siteVisitContext.ts) — this module stays
 * pure so the checklist can be reasoned about (and tested) without a database.
 */
export interface SiteVisitContext {
  deal: SiteVisitDeal;
  property: SiteVisitProperty | null;
  contact: SiteVisitContact | null;
  events: SiteVisitEvent[];
  transcriptCount: number;
  siblingDeals: SiteVisitSiblingDeal[];
  priorVisits: SiteVisitPriorVisit[];
  openTasks: SiteVisitTask[];
  /**
   * Answers recorded by earlier visits, keyed by checklist slug (most recent
   * wins). This is what makes the loop compound: an item with no column of its
   * own still counts as known once some past visit answered it.
   */
  priorAnswers: Record<string, string>;
}

/** One stored line of a session's conversation. `hidden` marks the synthetic
 *  kickoff turn that opens the visit — it is real history for the model, but
 *  never shown in the transcript. */
export interface SiteVisitTurn {
  role: "user" | "assistant";
  content: string;
  at: string;
  hidden?: boolean;
}

export interface SiteVisitSession {
  id: number;
  deal_id: number;
  property_id: number | null;
  tile_key: string;
  status: "open" | "closed";
  turns: SiteVisitTurn[];
  summary: string | null;
  started_at: string;
  ended_at: string | null;
}

/** The synthetic opening turn. Sent as the model's first user message so it
 *  greets with the brief already loaded, rather than waiting to be spoken to. */
export const KICKOFF_TEXT = "I'm starting the site visit now.";

export interface ChecklistItem {
  slug: string;
  label: string;
  /** How to ask it, when it turns out to be a gap. Fed to the agent verbatim. */
  ask: string;
  /**
   * Where a recorded answer ends up. `column` items write through to a real
   * column on an existing table; `log` items have no column yet and live in
   * site_visit_questions / site_visit_notes until the question log shows they
   * have hardened enough to deserve one.
   */
  storage: "column" | "log";
  /** The known value, or null when this is a genuine gap. */
  known: (ctx: SiteVisitContext) => string | null;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function contactName(c: SiteVisitContact | null): string {
  if (!c) return "";
  return [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
}

/** A prior visit's answer for `slug`, trimmed to something non-empty, or null. */
function prior(ctx: SiteVisitContext, slug: string): string | null {
  const v = ctx.priorAnswers[slug];
  return v && v.trim() ? v.trim() : null;
}

/**
 * The checklist. Order is the order the agent works through gaps, so the items
 * that shape the rest of the conversation (what the job even is) come first and
 * the administrative ones come last.
 */
export const CHECKLIST: ChecklistItem[] = [
  {
    slug: "scope",
    label: "Scope of work",
    ask: "What is the client actually asking for on this job?",
    storage: "column",
    known: (ctx) => ctx.deal.proposal_description?.trim() || null,
  },
  {
    slug: "client_priorities",
    label: "Client priorities",
    ask: "What matters most to them here — budget, speed, appearance, solving a specific problem?",
    storage: "log",
    known: (ctx) => prior(ctx, "client_priorities"),
  },
  {
    slug: "existing_issues",
    label: "Existing problems on site",
    ask: "What is failing or bothering them right now — drainage, dead plant material, settling, anything visible?",
    storage: "log",
    known: (ctx) => prior(ctx, "existing_issues"),
  },
  {
    slug: "site_conditions",
    label: "Site conditions",
    ask: "Soil, grade, sun and shade, drainage, irrigation — what are we working with?",
    storage: "log",
    known: (ctx) => prior(ctx, "site_conditions"),
  },
  {
    slug: "access",
    label: "Site access",
    ask: "How does equipment get in — gate widths, slope, parking, anything that limits machine access?",
    storage: "log",
    known: (ctx) => prior(ctx, "access"),
  },
  {
    slug: "constraints",
    label: "Constraints",
    ask: "Anything that constrains the work — HOA rules, pets, kids, dates they cannot have us there?",
    storage: "log",
    known: (ctx) => prior(ctx, "constraints"),
  },
  {
    slug: "value",
    label: "Ballpark value",
    ask: "Roughly what is this job worth, as a working number?",
    storage: "column",
    known: (ctx) => (ctx.deal.value != null ? money.format(ctx.deal.value) : null),
  },
  {
    slug: "schedule",
    label: "Work window",
    ask: "When would the work actually happen — a start and end date, even approximate?",
    storage: "column",
    known: (ctx) =>
      ctx.deal.start_date && ctx.deal.end_date
        ? `${ctx.deal.start_date} to ${ctx.deal.end_date}`
        : null,
  },
  {
    slug: "contact",
    label: "Contact details",
    ask: "Who is the point of contact, and what is the best number or email for them?",
    storage: "column",
    known: (ctx) => {
      const name = contactName(ctx.contact);
      if (!name) return null;
      const reach = [ctx.contact?.phone, ctx.contact?.email].filter(Boolean).join(", ");
      // A name with no way to reach them is still a gap worth closing.
      return reach ? `${name} — ${reach}` : null;
    },
  },
  {
    slug: "jobsite_address",
    label: "Jobsite address",
    ask: "What is the jobsite address?",
    storage: "column",
    known: (ctx) => ctx.property?.address?.trim() || null,
  },
  {
    slug: "next_action",
    label: "Next action",
    ask: "What is the single next thing that has to happen to move this forward?",
    storage: "column",
    known: (ctx) => ctx.openTasks.find((t) => t.is_next_action)?.title || null,
  },
];

export interface ChecklistState {
  slug: string;
  label: string;
  ask: string;
  storage: "column" | "log";
  /** The value already on file, or null when this is a gap to ask about. */
  known: string | null;
}

/** The checklist resolved against a live context: what is known, what is a gap. */
export function resolveChecklist(ctx: SiteVisitContext): ChecklistState[] {
  return CHECKLIST.map((item) => ({
    slug: item.slug,
    label: item.label,
    ask: item.ask,
    storage: item.storage,
    known: item.known(ctx),
  }));
}

export function gapsOf(state: ChecklistState[]): ChecklistState[] {
  return state.filter((s) => s.known == null);
}

/** Slugs the checklist knows about — used to validate what the agent logs. */
export const CHECKLIST_SLUGS: ReadonlySet<string> = new Set(CHECKLIST.map((i) => i.slug));

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

/**
 * The context brief that goes into the system prompt. Markdown, compact, and
 * written for a model rather than a screen — the UI renders the structured
 * context separately.
 */
export function renderBrief(ctx: SiteVisitContext, checklist: ChecklistState[]): string {
  const { deal, property, contact } = ctx;
  const lines: string[] = [];

  lines.push(`# Deal: ${deal.deal_name}`);
  if (deal.company) lines.push(`Company: ${deal.company}`);
  lines.push(`Stage: ${deal.stage}`);
  if (deal.proposal_number) lines.push(`Proposal #: ${deal.proposal_number}`);
  if (deal.value != null) lines.push(`Value on file: ${money.format(deal.value)}`);
  if (deal.proposal_description) lines.push(`Scope on file: ${deal.proposal_description}`);
  if (deal.appointment_date) lines.push(`Appointment: ${shortDate(deal.appointment_date)}`);
  if (deal.start_date || deal.end_date) {
    lines.push(`Work window on file: ${shortDate(deal.start_date)} – ${shortDate(deal.end_date)}`);
  }

  lines.push("");
  lines.push("## Property and contact");
  lines.push(property ? `Address: ${property.address}` : "Address: none on file");
  const name = contactName(contact);
  if (name) {
    const reach = [contact?.phone, contact?.email].filter(Boolean).join(" · ");
    lines.push(`Contact: ${name}${reach ? ` (${reach})` : " (no phone or email on file)"}`);
  } else {
    lines.push("Contact: none on file");
  }

  if (ctx.siblingDeals.length) {
    lines.push("");
    lines.push("## Other deals at this property");
    for (const s of ctx.siblingDeals.slice(0, 6)) {
      const bits = [s.stage];
      if (s.value != null) bits.push(money.format(s.value));
      if (s.won_date) bits.push(`won ${shortDate(s.won_date)}`);
      lines.push(`- ${s.deal_name} (${bits.join(", ")})${s.proposal_description ? ` — ${s.proposal_description}` : ""}`);
    }
  }

  if (ctx.events.length) {
    lines.push("");
    lines.push("## Recent activity");
    for (const e of ctx.events.slice(0, 6)) {
      const label = e.name || e.event_type || "Event";
      lines.push(`- ${shortDate(e.start_time)} — ${label}${e.photo_count ? ` (${e.photo_count} photos)` : ""}`);
    }
  }
  if (ctx.transcriptCount) {
    lines.push(`- ${ctx.transcriptCount} appointment transcript(s) already on this deal`);
  }

  if (ctx.priorVisits.length) {
    lines.push("");
    lines.push("## What earlier site visits established");
    for (const v of ctx.priorVisits.slice(0, 3)) {
      lines.push(`- ${shortDate(v.started_at)}: ${v.summary?.trim() || "(no summary written)"}`);
    }
  }

  if (ctx.openTasks.length) {
    lines.push("");
    lines.push("## Open tasks");
    for (const t of ctx.openTasks.slice(0, 8)) {
      lines.push(`- ${t.title}${t.is_next_action ? " (flagged as the next action)" : ""}`);
    }
  }

  const known = checklist.filter((c) => c.known != null);
  const gaps = gapsOf(checklist);

  lines.push("");
  lines.push("## Already known — do NOT ask about these");
  if (known.length) {
    for (const k of known) lines.push(`- ${k.label}: ${k.known}`);
  } else {
    lines.push("- (nothing on file yet)");
  }

  lines.push("");
  lines.push("## Genuine gaps — these are what this visit is for");
  if (gaps.length) {
    for (const g of gaps) lines.push(`- [${g.slug}] ${g.label} — ${g.ask}`);
  } else {
    lines.push("- (none: everything on the checklist is already answered)");
  }

  return lines.join("\n");
}
