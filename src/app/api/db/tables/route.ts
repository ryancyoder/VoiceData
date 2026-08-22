import { NextRequest, NextResponse } from "next/server";
import { MissingIntrospectionError, loadSchema } from "@/lib/dbBrowser";

// Every table/view in the public schema, with its columns — the left-hand list
// of the /db browser. Counts are a separate call (see ../counts) so this one
// stays fast.
export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    const tables = await loadSchema(refresh);
    return NextResponse.json({ tables });
  } catch (err) {
    if (err instanceof MissingIntrospectionError) {
      return NextResponse.json({ error: err.message, setupRequired: true }, { status: 501 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load schema" },
      { status: 500 }
    );
  }
}
