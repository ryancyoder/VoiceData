import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { TASK_CONTEXTS, type TaskInput } from "@/lib/tasks";

const TASK_SELECT =
  '*, deal:"Sales Board"(id, deal_name, company, stage, lost_at), photos:task_photos(id, task_id, storage_path, file_name, created_at)';

export async function GET() {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<TaskInput>;

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (body.context && !TASK_CONTEXTS.includes(body.context)) {
    return NextResponse.json({ error: `Invalid context "${body.context}"` }, { status: 400 });
  }
  if (body.is_next_action && body.deal_id == null) {
    return NextResponse.json({ error: "A next-action task must be tied to a deal" }, { status: 400 });
  }

  // Only one task per deal can be the next action — clearing any existing
  // holder first (rather than relying solely on the DB's partial unique
  // index) turns "swap the flag" into two plain updates instead of a
  // constraint violation.
  if (body.is_next_action && body.deal_id != null) {
    const { error: clearError } = await supabase
      .from("tasks")
      .update({ is_next_action: false })
      .eq("deal_id", body.deal_id)
      .eq("is_next_action", true);
    if (clearError) {
      return NextResponse.json({ error: clearError.message }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      deal_id: body.deal_id ?? null,
      context: body.context ?? null,
      start_date: body.start_date || null,
      duration_hours: body.duration_hours ?? null,
      is_next_action: body.is_next_action ?? false,
    })
    .select(TASK_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ task: data }, { status: 201 });
}
