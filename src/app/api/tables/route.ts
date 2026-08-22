import { NextRequest, NextResponse } from "next/server";
import { listTables } from "@/lib/tableBrowser";

// The table browser's schema feed: every table/view the project's REST API
// exposes, with column types and key metadata. See src/lib/tableBrowser.ts.
export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    const tables = await listTables(refresh);
    return NextResponse.json({ tables });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
