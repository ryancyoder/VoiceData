import { NextRequest, NextResponse } from "next/server";
import { getFlagSetting, setFlagSetting, TILE_MODE_KEY } from "@/lib/appSettings";

export const dynamic = "force-dynamic";

// Read/save the app-wide Tile mode flag. Kept as its own tiny route (rather
// than folded into sales-board-view) since it governs the whole app's
// navigation, not just the board.
export async function GET() {
  const tileMode = await getFlagSetting(TILE_MODE_KEY);
  return NextResponse.json({ tileMode });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { tileMode?: unknown };
  if (typeof body.tileMode !== "boolean") {
    return NextResponse.json({ error: "tileMode must be true or false" }, { status: 400 });
  }
  const { error } = await setFlagSetting(TILE_MODE_KEY, body.tileMode);
  if (error) {
    return NextResponse.json({ error: `Couldn't save: ${error}` }, { status: 500 });
  }
  const tileMode = await getFlagSetting(TILE_MODE_KEY);
  return NextResponse.json({ tileMode });
}
