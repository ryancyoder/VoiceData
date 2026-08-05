import { NextRequest, NextResponse } from "next/server";
import { mergeEvents } from "@/lib/events";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = (await req.json()) as { targetEventId?: unknown };
  const targetEventId = Number(body.targetEventId);
  if (!Number.isFinite(targetEventId)) {
    return NextResponse.json({ error: "targetEventId is required" }, { status: 400 });
  }

  try {
    const event = await mergeEvents(Number(id), targetEventId);
    return NextResponse.json({ event });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to merge events" }, { status: 500 });
  }
}
