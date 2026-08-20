import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// Add an appointment transcript to a deal. Text-only — no file upload.
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    transcript?: unknown;
    title?: unknown;
    recorded_at?: unknown;
    event_id?: unknown;
  };

  if (typeof body.transcript !== "string" || !body.transcript.trim()) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }

  const insert: {
    deal_id: number;
    transcript: string;
    title: string | null;
    recorded_at: string | null;
    event_id: number | null;
  } = {
    deal_id: Number(id),
    transcript: body.transcript.trim(),
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : null,
    recorded_at: typeof body.recorded_at === "string" && body.recorded_at.trim() ? body.recorded_at : null,
    event_id: typeof body.event_id === "number" && Number.isFinite(body.event_id) ? body.event_id : null,
  };

  const { data, error } = await supabase.from("deal_transcripts").insert(insert).select().single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ transcript: data }, { status: 201 });
}
