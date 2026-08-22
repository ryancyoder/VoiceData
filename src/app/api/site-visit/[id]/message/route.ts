import { NextRequest, NextResponse } from "next/server";
import { resolveChecklist } from "@/lib/siteVisit";
import { loadSiteVisitContext, SiteVisitContextError } from "@/lib/siteVisitContext";
import { runSiteVisitTurn } from "@/lib/siteVisitAgent";
import { appendTurns, fetchSession, historyFromTurns, loadSessionView } from "@/lib/siteVisitSession";

export const maxDuration = 60;

type RouteParams = { params: Promise<{ id: string }> };

/**
 * One spoken (or typed) turn of the visit.
 *
 * The context is reloaded before the turn — so a gap answered a moment ago now
 * reads as known and the agent stops asking about it — and again afterwards, so
 * the checklist that comes back reflects whatever this turn's tools just wrote.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const session = await fetchSession(Number(id));
  if (!session) return NextResponse.json({ error: "No such session" }, { status: 404 });
  if (session.status !== "open") {
    return NextResponse.json({ error: "This visit is already closed out" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  let context;
  try {
    context = await loadSiteVisitContext(session.deal_id);
  } catch (err) {
    const status = err instanceof SiteVisitContextError ? 404 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }

  let turn;
  try {
    turn = await runSiteVisitTurn(
      historyFromTurns(session.turns, text),
      { sessionId: session.id, dealId: session.deal_id, ctx: context },
      resolveChecklist(context)
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const now = new Date().toISOString();
  await appendTurns(session.id, session.turns, [
    { role: "user", content: text, at: now },
    { role: "assistant", content: turn.reply, at: new Date().toISOString() },
  ]);

  const refreshed = await fetchSession(session.id);
  const view = await loadSessionView(refreshed ?? session);
  return NextResponse.json({ ...view, reply: turn.reply, toolCalls: turn.toolCalls });
}
