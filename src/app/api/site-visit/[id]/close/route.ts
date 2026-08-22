import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { summarizeVisit } from "@/lib/siteVisitAgent";
import { fetchSession, loadSessionView, visibleTurns } from "@/lib/siteVisitSession";

export const maxDuration = 60;

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Close the visit out. Writes a plain-prose summary onto the session, which is
 * what the NEXT visit's brief leads with — the loop that makes each tap of the
 * tile start further along than the last.
 */
export async function POST(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const session = await fetchSession(Number(id));
  if (!session) return NextResponse.json({ error: "No such session" }, { status: 404 });
  if (session.status === "closed") {
    return NextResponse.json({ error: "This visit is already closed out" }, { status: 409 });
  }

  // A failed summary must not strand the session open — close it either way and
  // report the summary error separately.
  let summary = "";
  let summaryError: string | null = null;
  try {
    summary = await summarizeVisit(visibleTurns(session.turns));
  } catch (err) {
    summaryError = (err as Error).message;
  }

  const { error } = await supabase
    .from("site_visit_sessions")
    .update({
      status: "closed",
      ended_at: new Date().toISOString(),
      summary: summary || null,
    })
    .eq("id", session.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const closed = await fetchSession(session.id);
  const view = await loadSessionView(closed ?? session);
  return NextResponse.json({ ...view, summaryError });
}
