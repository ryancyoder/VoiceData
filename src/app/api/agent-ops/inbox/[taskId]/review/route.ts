import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ taskId: string }> };

// Release a held item into the Human Action Inbox.
//
// Normally project-manager does this, after rewriting the agent's wording so
// it reads like something a person can act on. Nothing runs project-manager on
// a schedule yet, so this is the manual override — otherwise an item an agent
// raised would sit unreviewed and invisible forever.
//
// Only the timestamp is set. instructions_reviewed_by is a foreign key to
// agent_registry, so it cannot name a person — and leaving it null is the
// honest record: released without an agent having reviewed the wording.
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { taskId } = await params;

  const { data, error } = await supabase
    .from("tasks")
    .update({ instructions_reviewed_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("requires_human", true)
    .is("instructions_reviewed_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not a held item" }, { status: 404 });

  return NextResponse.json({ ok: true, id: data.id });
}
