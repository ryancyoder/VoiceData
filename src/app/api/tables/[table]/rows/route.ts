import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  fetchRowByKey,
  fetchRows,
  findTable,
} from "@/lib/tableBrowser";

export const dynamic = "force-dynamic";

// A page of rows from one table. The table name comes from the URL, so it is
// checked against the introspected schema before it reaches a query — the
// service-role key bypasses RLS, and only browsable tables should be reachable
// through here. Read-only: there is no POST/PATCH/DELETE on this route.
export async function GET(req: NextRequest, { params }: RouteContext<"/api/tables/[table]/rows">) {
  const { table: tableName } = await params;
  const sp = req.nextUrl.searchParams;

  let table;
  try {
    table = await findTable(decodeURIComponent(tableName));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load the schema" },
      { status: 500 }
    );
  }
  if (!table) {
    return NextResponse.json({ error: `Unknown table "${tableName}"` }, { status: 404 });
  }

  try {
    // `key=<pk>` asks for one row with nothing truncated, for the detail panel.
    const key = sp.get("key");
    if (key !== null) {
      const row = await fetchRowByKey(table, key);
      if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });
      return NextResponse.json({ row });
    }

    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get("pageSize")) || DEFAULT_PAGE_SIZE));
    const result = await fetchRows(table, {
      page: Math.max(1, Number(sp.get("page")) || 1),
      pageSize,
      sort: sp.get("sort"),
      ascending: sp.get("dir") !== "desc",
      search: sp.get("q") ?? "",
    });

    return NextResponse.json({ ...result, table });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load rows" },
      { status: 500 }
    );
  }
}
