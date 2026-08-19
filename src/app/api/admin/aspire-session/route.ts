import { NextRequest, NextResponse } from "next/server";
import { checkAspireSession } from "@/lib/aspireBrowser";
import {
  ASPIRE_BASE_URL,
  aspireSessionStatus,
  clearAspireFailure,
  clearAspireSession,
  hasSessionSecret,
  parseCookieInput,
  saveAspireSession,
} from "@/lib/aspireSession";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET() {
  return NextResponse.json(await aspireSessionStatus());
}

export async function POST(req: NextRequest) {
  let body: { action?: unknown; cookies?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (body.action === "test") {
    const result = await checkAspireSession();
    return NextResponse.json({ ...result, status: await aspireSessionStatus() });
  }

  const raw = typeof body.cookies === "string" ? body.cookies : "";
  if (!raw.trim()) {
    return NextResponse.json({ error: "Paste the Aspire cookies to store" }, { status: 400 });
  }
  if (!hasSessionSecret()) {
    return NextResponse.json(
      { error: "ASPIRE_SESSION_SECRET isn't set on this deployment — set it before storing a session" },
      { status: 503 }
    );
  }

  let cookies;
  try {
    cookies = parseCookieInput(raw, new URL(ASPIRE_BASE_URL).hostname);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  if (cookies.length === 0) {
    return NextResponse.json({ error: "Couldn't find any cookies in that paste" }, { status: 400 });
  }

  const { error } = await saveAspireSession(cookies);
  if (error) return NextResponse.json({ error }, { status: 500 });

  // A fresh session invalidates whatever the last failure was complaining about.
  await clearAspireFailure();
  return NextResponse.json({ saved: cookies.length, status: await aspireSessionStatus() });
}

export async function DELETE() {
  const { error } = await clearAspireSession();
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ status: await aspireSessionStatus() });
}
