import { NextRequest, NextResponse } from "next/server";
import { createEventManually, EVENT_TYPES, type EventType } from "@/lib/events";

function parseEventType(value: unknown): EventType | null {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value) ? (value as EventType) : null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    name?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    property_id?: unknown;
    deal_id?: unknown;
    event_type?: unknown;
    notes?: unknown;
  };

  const startTime = typeof body.start_time === "string" ? body.start_time : "";
  const endTime = typeof body.end_time === "string" ? body.end_time : "";
  if (!startTime || !endTime || isNaN(new Date(startTime).getTime()) || isNaN(new Date(endTime).getTime())) {
    return NextResponse.json({ error: "start_time and end_time are required" }, { status: 400 });
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  const propertyId =
    typeof body.property_id === "number" ? body.property_id : Number(body.property_id) || null;
  const dealId = typeof body.deal_id === "number" ? body.deal_id : Number(body.deal_id) || null;
  const eventType = parseEventType(body.event_type);
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes : null;

  try {
    const event = await createEventManually({
      name,
      start_time: startTime,
      end_time: endTime,
      property_id: propertyId,
      deal_id: dealId,
      event_type: eventType,
      notes,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create event" }, { status: 500 });
  }
}
