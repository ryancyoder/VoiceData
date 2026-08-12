import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/authCookie";

// Exchange the shared password for a session cookie. The cookie value is the
// server-only SESSION_TOKEN secret; the middleware admits a request only when
// the cookie equals that same secret. httpOnly so client JS can't read it.
export async function POST(req: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  const sessionToken = process.env.SESSION_TOKEN;
  if (!appPassword || !sessionToken) {
    return NextResponse.json({ error: "Auth is not configured on the server." }, { status: 500 });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (password !== appPassword) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90 days
  });
  return res;
}
