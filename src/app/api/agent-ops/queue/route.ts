import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { QueueRow } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

const LIVE = ["pending", "claimed", "failed"];
const DONE_LIMIT = 40;

// The bus. Live rows come from agent_queue_live, which already orders them the
// way they want reading — failed first, then in flight, then pending by
// priority. Finished rows are a separate, capped read: useful for review, but
// they are history and should not crowd out what still needs attention.
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get("agent");

  let live = supabase.from("agent_queue_live").select("*");
  if (agent) live = live.eq("to_agent", agent);

  let finished = supabase
    .from("agent_queue")
    .select("*")
    .in("status", ["done", "cancelled"])
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(DONE_LIMIT);
  if (agent) finished = finished.eq("to_agent", agent);

  const [liveRes, doneRes] = await Promise.all([live, finished]);
  if (liveRes.error) return NextResponse.json({ error: liveRes.error.message }, { status: 500 });
  if (doneRes.error) return NextResponse.json({ error: doneRes.error.message }, { status: 500 });

  return NextResponse.json({
    live: (liveRes.data ?? []) as QueueRow[],
    finished: (doneRes.data ?? []) as QueueRow[],
    liveStatuses: LIVE,
  });
}
