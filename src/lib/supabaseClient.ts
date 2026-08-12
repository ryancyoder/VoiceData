import { createClient } from "@supabase/supabase-js";

// One client, two identities:
//  - On the server (API routes, server components) we use the SERVICE ROLE key
//    when it's configured. It bypasses RLS, so once the public "allow all"
//    policies are removed the app keeps working — but ONLY through our own
//    server code, which sits behind the app's password gate (see middleware.ts).
//  - In the browser we use the public ANON key. Next.js never exposes a
//    non-NEXT_PUBLIC env var to client bundles, so SUPABASE_SERVICE_ROLE_KEY is
//    `undefined` there and the service key can never ship to the browser.
//
// If SUPABASE_SERVICE_ROLE_KEY isn't set yet, the server falls back to the anon
// key (today's behavior) — so this change is safe to deploy before the key is
// configured and before RLS is locked down.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isServer = typeof window === "undefined";

const key = isServer && serviceKey ? serviceKey : anonKey;

if (!url || !key) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
  );
}

// No session persistence: the service-role client must never try to read/write
// a browser session, and the anon client here is only used for signed-URL
// storage uploads, which don't need a persisted auth session either.
export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
