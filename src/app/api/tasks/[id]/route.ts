import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { TASK_CONTEXTS, type TaskInput } from "@/lib/tasks";
import { syncDealNextActionPhoto } from "@/lib/nextActionPhoto";

const TASK_SELECT =
  '*, deal:"Sales Board"(id, deal_name, company, stage, lost_at), photos:task_photos(id, task_id, storage_path, file_name, created_at)';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as Partial<TaskInput>;

  if (body.context !== undefined && body.context && !TASK_CONTEXTS.includes(body.context)) {
    return NextResponse.json({ error: `Invalid context "${body.context}"` }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const trimmed = body.title.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    }
    updates.title = trimmed;
  }
  if (body.deal_id !== undefined) updates.deal_id = body.deal_id;
  if (body.context !== undefined) updates.context = body.context;
  if (body.start_date !== undefined) updates.start_date = body.start_date || null;
  if (body.duration_hours !== undefined) updates.duration_hours = body.duration_hours;
  if (body.completed_at !== undefined) updates.completed_at = body.completed_at;

  if (body.is_next_action !== undefined) {
    if (body.is_next_action) {
      // The deal this task belongs to after this update — whatever's being
      // set in this same request, or its current one otherwise.
      let dealId = body.deal_id;
      if (dealId === undefined) {
        const { data: existing, error: existingError } = await supabase
          .from("tasks")
          .select("deal_id")
          .eq("id", id)
          .maybeSingle();
        if (existingError) {
          return NextResponse.json({ error: existingError.message }, { status: 500 });
        }
        dealId = existing?.deal_id ?? null;
      }
      if (dealId == null) {
        return NextResponse.json({ error: "A next-action task must be tied to a deal" }, { status: 400 });
      }
      const { error: clearError } = await supabase
        .from("tasks")
        .update({ is_next_action: false })
        .eq("deal_id", dealId)
        .eq("is_next_action", true)
        .neq("id", id);
      if (clearError) {
        return NextResponse.json({ error: clearError.message }, { status: 500 });
      }
    }
    updates.is_next_action = body.is_next_action;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
  }

  const { data, error } = await supabase.from("tasks").update(updates).eq("id", id).select(TASK_SELECT).single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // The next-action photo follows the marked task — re-derive it whenever the
  // is_next_action flag changed.
  if (body.is_next_action !== undefined && data?.deal_id != null) {
    await syncDealNextActionPhoto(data.deal_id);
  }
  return NextResponse.json({ task: data });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Capture the deal before deleting, so we can re-derive its next-action photo
  // (deal_photos.task_id is ON DELETE SET NULL, so any action photo survives but
  // is no longer the deal's next action).
  const { data: task } = await supabase.from("tasks").select("deal_id, is_next_action").eq("id", id).maybeSingle();

  const { error } = await supabase.from("tasks").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (task?.is_next_action && task.deal_id != null) {
    await syncDealNextActionPhoto(task.deal_id);
  }
  return NextResponse.json({ ok: true });
}
