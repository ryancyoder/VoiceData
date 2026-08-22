import { NextResponse } from "next/server";
import { fetchSession, loadSessionView } from "@/lib/siteVisitSession";
import { SiteVisitContextError } from "@/lib/siteVisitContext";

type RouteParams = { params: Promise<{ id: string }> };

/** The session as it stands: transcript, brief, and the checklist re-resolved
 *  against the database right now (so anything written last turn reads as known). */
export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const session = await fetchSession(Number(id));
  if (!session) return NextResponse.json({ error: "No such session" }, { status: 404 });
  try {
    return NextResponse.json(await loadSessionView(session));
  } catch (err) {
    const status = err instanceof SiteVisitContextError ? 404 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
