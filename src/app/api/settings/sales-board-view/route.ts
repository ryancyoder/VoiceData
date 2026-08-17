import { NextRequest, NextResponse } from "next/server";
import { getFlagSetting, setFlagSetting, SALES_BOARD_HOVER_PHOTO_KEY } from "@/lib/appSettings";

export const dynamic = "force-dynamic";

// Read/save the Sales Board's view options. Only the board's own display
// preferences belong here — the deal data itself is loaded by the page.
export async function GET() {
  return NextResponse.json({ hoverPropertyPhoto: await getFlagSetting(SALES_BOARD_HOVER_PHOTO_KEY) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { hoverPropertyPhoto?: unknown };

  if (typeof body.hoverPropertyPhoto !== "boolean") {
    return NextResponse.json({ error: "hoverPropertyPhoto must be true or false" }, { status: 400 });
  }

  // Report a dropped write instead of echoing the value back as if it stuck —
  // otherwise the toggle looks saved and silently reverts on the next load.
  const { error } = await setFlagSetting(SALES_BOARD_HOVER_PHOTO_KEY, body.hoverPropertyPhoto);
  if (error) {
    return NextResponse.json({ error: `Couldn't save: ${error}` }, { status: 500 });
  }

  return NextResponse.json({ hoverPropertyPhoto: body.hoverPropertyPhoto });
}
