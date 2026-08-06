import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { analyzeTaskText } from "@/lib/analyzeTask";

const TASK_SELECT = '*, deal:"Sales Board"(id, deal_name, company, stage, lost_at)';

type RouteParams = { params: Promise<{ id: string }> };

// Fills in context/start_date/duration_hours from the task's own title —
// run right after a task is logged from raw dictated text (see
// QuickAddTask), but safe to call any time since it only ever fills in
// fields that are still unset, never overwrites something already there
// (e.g. a manual edit that happened in the meantime).
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("title, context, start_date, duration_hours")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let analyzed;
  try {
    analyzed = await analyzeTaskText(existing.title);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Analysis failed" }, { status: 500 });
  }

  const updates: Record<string, unknown> = {};
  if (existing.context == null && analyzed.context != null) updates.context = analyzed.context;
  if (existing.start_date == null && analyzed.start_date != null) updates.start_date = analyzed.start_date;
  if (existing.duration_hours == null && analyzed.duration_hours != null) updates.duration_hours = analyzed.duration_hours;

  if (Object.keys(updates).length === 0) {
    const { data, error } = await supabase.from("tasks").select(TASK_SELECT).eq("id", id).single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ task: data });
  }

  const { data, error } = await supabase.from("tasks").update(updates).eq("id", id).select(TASK_SELECT).single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ task: data });
}
