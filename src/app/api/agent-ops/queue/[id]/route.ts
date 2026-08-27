import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { QueueRow } from "@/lib/agentOps";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

// Reviewing the queue by hand. Three things a person needs to be able to do to
// a row that an agent cannot do for itself.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = typeof body.action === "string" ? body.action : "";

  let update: Record<string, unknown>;
  switch (action) {
    // A failed row goes back on the bus with a clean slate. Attempts reset:
    // a person retrying has usually changed something, so spending the
    // remaining attempt on the old state would waste the retry.
    case "retry":
      update = {
        status: "pending",
        error: null,
        attempts: 0,
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
        not_before: new Date().toISOString(),
      };
      break;

    // A row an agent is holding but is not working — its lease ran out, or the
    // session died. Hand it back so someone can claim it again.
    case "release":
      update = {
        status: "pending",
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
      };
      break;

    // Not deleted: the row stays as a record of something that was asked for
    // and deliberately not done. claim_agent_work only takes pending rows, so
    // a cancelled one is inert.
    case "cancel":
      update = {
        status: "cancelled",
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        error: "cancelled from the console",
      };
      break;

    default:
      return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("agent_queue")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No such queue row" }, { status: 404 });

  return NextResponse.json({ row: data as QueueRow });
}
