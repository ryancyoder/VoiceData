import { NextResponse } from "next/server";
import { MissingIntrospectionError, loadRowCounts } from "@/lib/dbBrowser";

// Exact row count per table. Split out from /api/db/tables because it runs a
// count(*) per table: the browser renders the table list first and fills these
// in when they arrive.
export async function GET() {
  try {
    const counts = await loadRowCounts();
    return NextResponse.json({ counts });
  } catch (err) {
    if (err instanceof MissingIntrospectionError) {
      return NextResponse.json({ error: err.message, setupRequired: true }, { status: 501 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to count rows" },
      { status: 500 }
    );
  }
}
