import { NextResponse } from "next/server";
import { listTables } from "@/lib/tableBrowser";

export const dynamic = "force-dynamic";

// Every table and view Supabase exposes, with its columns. Read-only.
export async function GET() {
  try {
    return NextResponse.json({ tables: await listTables() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load the schema" },
      { status: 500 }
    );
  }
}
