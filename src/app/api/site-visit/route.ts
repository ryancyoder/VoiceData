import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { KICKOFF_TEXT, SITE_VISIT_TILE_KEY, resolveChecklist } from "@/lib/siteVisit";
import { loadSiteVisitContext, SiteVisitContextError } from "@/lib/siteVisitContext";
import { runSiteVisitTurn } from "@/lib/siteVisitAgent";
import { appendTurns, historyFromTurns, loadSessionView, normalizeSession, SESSION_COLUMNS } from "@/lib/siteVisitSession";

export const maxDuration = 60;

const DEALS_TABLE = "Sales Board";

/**
 * GET  /api/site-visit             → the deals a visit can be started on, plus any open sessions
 * GET  /api/site-visit?deal=<id>   → that deal's brief and checklist, without starting anything
 */
export async function GET(req: NextRequest) {
  const dealParam = req.nextUrl.searchParams.get("deal");

  if (dealParam) {
    const dealId = Number(dealParam);
    if (!Number.isFinite(dealId)) {
      return NextResponse.json({ error: "deal must be a number" }, { status: 400 });
    }
    try {
      const context = await loadSiteVisitContext(dealId);
      const checklist = resolveChecklist(context);
      const open = await supabase
        .from("site_visit_sessions")
        .select(SESSION_COLUMNS)
        .eq("deal_id", dealId)
        .eq("status", "open")
        .maybeSingle();
      return NextResponse.json({
        context,
        checklist,
        openSession: open.data ? normalizeSession(open.data) : null,
      });
    } catch (err) {
      const status = err instanceof SiteVisitContextError ? 404 : 500;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
  }

  // The tile's own picker: open (not lost) deals, most recently touched first.
  const dealsRes = await supabase
    .from(DEALS_TABLE)
    .select("id, deal_name, company, stage, value, updated_at, properties(address, contacts(last_name))")
    .is("lost_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (dealsRes.error) {
    return NextResponse.json({ error: dealsRes.error.message }, { status: 500 });
  }

  const openRes = await supabase
    .from("site_visit_sessions")
    .select("id, deal_id, started_at")
    .eq("status", "open")
    .order("started_at", { ascending: false });

  type RawDeal = {
    id: number;
    deal_name: string;
    company: string | null;
    stage: string;
    value: number | null;
    updated_at: string;
    properties: { address: string; contacts: { last_name: string | null } | null } | null;
  };

  const deals = ((dealsRes.data ?? []) as unknown as RawDeal[]).map((d) => ({
    id: d.id,
    deal_name: d.deal_name,
    company: d.company,
    stage: d.stage,
    value: d.value,
    address: d.properties?.address ?? null,
    contact_last_name: d.properties?.contacts?.last_name ?? null,
  }));

  return NextResponse.json({
    deals,
    openSessions: openRes.error ? [] : (openRes.data ?? []),
  });
}

/**
 * POST /api/site-visit  { deal_id }
 * Start a visit on a deal — or resume the one already open on it. The tile is
 * the only way in, so the whole point is that this arrives already knowing the
 * deal: the brief is built and the agent opens the conversation before the user
 * has said anything.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { deal_id?: unknown };
  const dealId = Number(body.deal_id);
  if (!Number.isFinite(dealId)) {
    return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
  }

  let context;
  try {
    context = await loadSiteVisitContext(dealId);
  } catch (err) {
    const status = err instanceof SiteVisitContextError ? 404 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }

  // Re-tapping the tile on a deal already under way resumes it rather than
  // forking a second live conversation (the DB enforces this too, with a
  // partial unique index on the open status).
  const existing = await supabase
    .from("site_visit_sessions")
    .select(SESSION_COLUMNS)
    .eq("deal_id", dealId)
    .eq("status", "open")
    .maybeSingle();
  if (existing.data) {
    const view = await loadSessionView(normalizeSession(existing.data));
    return NextResponse.json({ ...view, resumed: true });
  }

  const created = await supabase
    .from("site_visit_sessions")
    .insert({
      deal_id: dealId,
      property_id: context.deal.property_id,
      tile_key: SITE_VISIT_TILE_KEY,
    })
    .select(SESSION_COLUMNS)
    .single();
  if (created.error) {
    return NextResponse.json({ error: created.error.message }, { status: 500 });
  }
  const session = normalizeSession(created.data);
  const checklist = resolveChecklist(context);

  // Kick the agent off so it greets with the brief already loaded. If the model
  // call fails the session still exists and the user can just start talking.
  const now = new Date().toISOString();
  try {
    const turn = await runSiteVisitTurn(
      historyFromTurns([], KICKOFF_TEXT),
      { sessionId: session.id, dealId, ctx: context },
      checklist
    );
    await appendTurns(session.id, [], [
      { role: "user", content: KICKOFF_TEXT, at: now, hidden: true },
      { role: "assistant", content: turn.reply, at: new Date().toISOString() },
    ]);
  } catch {
    await appendTurns(session.id, [], [{ role: "user", content: KICKOFF_TEXT, at: now, hidden: true }]);
  }

  const fresh = await supabase.from("site_visit_sessions").select(SESSION_COLUMNS).eq("id", session.id).single();
  const view = await loadSessionView(normalizeSession(fresh.data ?? session));
  return NextResponse.json({ ...view, resumed: false }, { status: 201 });
}
