import { NextRequest, NextResponse } from "next/server";
import { importPendingUprightSessions, importUprightSession } from "@/lib/uprightImport";

export const dynamic = "force-dynamic";

// Bridges Upright site sessions into VoiceData: copies each session's photos
// into the matched property's album and logs the session as a calendar event.
// With a session_id it imports just that one; otherwise it sweeps every
// not-yet-imported session (the schedulable + "Import Upright sessions" path).
export async function POST(req: NextRequest) {
  let sessionId: string | null = null;
  try {
    const body = (await req.json().catch(() => null)) as { session_id?: unknown } | null;
    if (body && typeof body.session_id === "string" && body.session_id.trim()) {
      sessionId = body.session_id.trim();
    }
  } catch {
    /* empty/no body is fine — treated as an import-all sweep */
  }

  try {
    if (sessionId) {
      const outcome = await importUprightSession(sessionId);
      return NextResponse.json({ outcome });
    }
    const summary = await importPendingUprightSessions();
    return NextResponse.json({ summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import Upright sessions" },
      { status: 500 }
    );
  }
}
