import { NextRequest, NextResponse } from "next/server";
import {
  getFlagSetting,
  setFlagSetting,
  SALES_BOARD_HOVER_PHOTO_KEY,
  SALES_BOARD_HOVER_PHOTO_WIDE_KEY,
} from "@/lib/appSettings";

export const dynamic = "force-dynamic";

// Read/save the Sales Board's view options. Only the board's own display
// preferences belong here — the deal data itself is loaded by the page.
export async function GET() {
  const [hoverPropertyPhoto, hoverPropertyPhotoWide] = await Promise.all([
    getFlagSetting(SALES_BOARD_HOVER_PHOTO_KEY),
    getFlagSetting(SALES_BOARD_HOVER_PHOTO_WIDE_KEY),
  ]);
  return NextResponse.json({ hoverPropertyPhoto, hoverPropertyPhotoWide });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    hoverPropertyPhoto?: unknown;
    hoverPropertyPhotoWide?: unknown;
  };

  // Each flag is optional so the client can PATCH one toggle without having to
  // restate the other, but anything present has to be a real boolean.
  const updates: [string, boolean][] = [];
  for (const [field, key] of [
    ["hoverPropertyPhoto", SALES_BOARD_HOVER_PHOTO_KEY],
    ["hoverPropertyPhotoWide", SALES_BOARD_HOVER_PHOTO_WIDE_KEY],
  ] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      return NextResponse.json({ error: `${field} must be true or false` }, { status: 400 });
    }
    updates.push([key, value]);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No settings supplied" }, { status: 400 });
  }

  // Report a dropped write instead of echoing the value back as if it stuck —
  // otherwise the toggle looks saved and silently reverts on the next load.
  for (const [key, value] of updates) {
    const { error } = await setFlagSetting(key, value);
    if (error) {
      return NextResponse.json({ error: `Couldn't save: ${error}` }, { status: 500 });
    }
  }

  const [hoverPropertyPhoto, hoverPropertyPhotoWide] = await Promise.all([
    getFlagSetting(SALES_BOARD_HOVER_PHOTO_KEY),
    getFlagSetting(SALES_BOARD_HOVER_PHOTO_WIDE_KEY),
  ]);
  return NextResponse.json({ hoverPropertyPhoto, hoverPropertyPhotoWide });
}
