import { NextResponse } from "next/server";
import { loadTables } from "@/lib/dbBrowser";

// The table browser's schema list: every table/view PostgREST exposes, with
// each one's columns, types and key roles. Read-only, and behind the app
// password gate like every other route (see middleware.ts).

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tables = await loadTables(true);
    return NextResponse.json({ tables });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load schema" },
      { status: 500 }
    );
  }
}
