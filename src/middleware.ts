import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/authCookie";

// App-wide password gate. Every request must carry a valid session cookie
// (set by /api/auth/login after the shared password is entered) — otherwise
// pages redirect to /login and API calls get a 401. This keeps the public off
// both the UI and the API routes, which is what makes it safe to move all
// database access to the service-role key (see supabaseClient.ts).
//
// The matcher already excludes Next internals, the login page, and the auth
// endpoints; everything else is gated.
export function middleware(req: NextRequest) {
  const expected = process.env.SESSION_TOKEN;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  // If no SESSION_TOKEN is configured yet, don't lock anyone out (lets this
  // deploy safely before the env vars are set); the gate activates the moment
  // SESSION_TOKEN exists.
  if (!expected || token === expected) {
    return NextResponse.next();
  }

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Gate everything except Next internals, static asset files, the login page,
  // the auth endpoints (which must be reachable while logged out), the VoiceMap
  // sync API (cross-origin PWA; guarded by its own bearer token — see
  // src/lib/voicemap.ts), and the inbound-email webhook (called by Postmark,
  // guarded by its own token — see api/emails/inbound).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login|api/auth|api/voicemap|api/emails/inbound|.*\\.(?:png|jpe?g|gif|svg|ico|webp|avif|json|txt|xml|woff2?|ttf|map)).*)",
  ],
};
