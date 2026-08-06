import { NextRequest, NextResponse } from "next/server";
import { updateEvent, EVENT_TYPES, type EventType } from "@/lib/events";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as {
    name?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    property_id?: unknown;
    deal_id?: unknown;
    event_type?: unknown;
    notes?: unknown;
  };

  const patch: {
    name?: string | null;
    start_time?: string;
    end_time?: string;
    property_id?: number | null;
    deal_id?: number | null;
    event_type?: EventType | null;
    notes?: string | null;
  } = {};

  if ("name" in body) {
    patch.name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  }
  if ("start_time" in body) {
    if (typeof body.start_time !== "string" || isNaN(new Date(body.start_time).getTime())) {
      return NextResponse.json({ error: "Invalid start_time" }, { status: 400 });
    }
    patch.start_time = body.start_time;
  }
  if ("end_time" in body) {
    if (typeof body.end_time !== "string" || isNaN(new Date(body.end_time).getTime())) {
      return NextResponse.json({ error: "Invalid end_time" }, { status: 400 });
    }
    patch.end_time = body.end_time;
  }
  if ("property_id" in body) {
    patch.property_id = body.property_id == null ? null : Number(body.property_id);
  }
  if ("deal_id" in body) {
    patch.deal_id = body.deal_id == null ? null : Number(body.deal_id);
  }
  if ("event_type" in body) {
    patch.event_type =
      typeof body.event_type === "string" && (EVENT_TYPES as readonly string[]).includes(body.event_type)
        ? (body.event_type as EventType)
        : null;
  }
  if ("notes" in body) {
    patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes : null;
  }

  try {
    const event = await updateEvent(Number(id), patch);
    return NextResponse.json({ event });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update event" }, { status: 500 });
  }
}
