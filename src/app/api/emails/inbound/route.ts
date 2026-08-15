import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// Inbound-email webhook. Postmark POSTs a parsed email here whenever one is
// forwarded to the inbound address. We match it to a contact by ANY address on
// the message — including addresses parsed out of the forwarded body, since a
// manual iOS forward rewrites From to the sender and buries the real
// participants in the quoted text — then to that contact's property, and store
// it in the `emails` table for the deal modal's Emails list + timeline.
//
// Guarded by its own token (EMAIL_INBOUND_TOKEN), not the app's session cookie,
// because Postmark can't log in — the route is excluded from the middleware
// gate (see src/middleware.ts). Point Postmark at:
//   https://<app>/api/emails/inbound?token=<EMAIL_INBOUND_TOKEN>

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

type PostmarkAddr = { Email?: string; Name?: string };
type PostmarkInbound = {
  FromFull?: PostmarkAddr;
  ToFull?: PostmarkAddr[];
  CcFull?: PostmarkAddr[];
  Subject?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  MessageID?: string;
};

function collectAddresses(p: PostmarkInbound): string[] {
  const out = new Set<string>();
  const add = (e?: string) => {
    if (e && e.includes("@")) out.add(e.trim().toLowerCase());
  };
  add(p.FromFull?.Email);
  for (const a of p.ToFull ?? []) add(a.Email);
  for (const a of p.CcFull ?? []) add(a.Email);
  // Parse the body/subject too — the original sender of a forwarded message
  // lives in the quoted "From: … <addr>" lines, not the envelope headers.
  const scanned = `${p.Subject ?? ""}\n${p.TextBody ?? ""}`;
  for (const m of scanned.matchAll(EMAIL_RE)) add(m[0]);
  return [...out];
}

function makeSnippet(p: PostmarkInbound): string | null {
  const raw = (p.TextBody ?? p.StrippedTextReply ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

// Diagnostic only: a browser GET reports whether the server has the token
// configured (never reveals it, never compares a provided one). Lets you tell
// "env var missing" from "token mismatch" without guessing. The real ingest is
// POST-only below.
export async function GET() {
  const t = process.env.EMAIL_INBOUND_TOKEN ?? "";
  // Length + trimmed-length only (never the value). Expected length is 48; a
  // different length, or trimmedLength !== length (stray whitespace/newline),
  // pinpoints a bad paste without revealing the secret.
  return NextResponse.json({
    ok: true,
    tokenConfigured: t.length > 0,
    length: t.length,
    trimmedLength: t.trim().length,
  });
}

export async function POST(req: NextRequest) {
  // Trim both sides: a trailing newline/space pasted into the env var (a very
  // common mistake) shouldn't silently 401 every inbound email.
  const expected = process.env.EMAIL_INBOUND_TOKEN?.trim();
  const token = (req.nextUrl.searchParams.get("token") ?? req.headers.get("x-inbound-token"))?.trim();
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: PostmarkInbound;
  try {
    payload = (await req.json()) as PostmarkInbound;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const addresses = collectAddresses(payload);

  // Match to a contact by any address on the message, then to that contact's
  // property (the property whose primary contact this is). Contact emails may
  // be stored with any casing, so compare case-insensitively in code rather
  // than with a case-sensitive `.in()`.
  let contactId: number | null = null;
  let propertyId: number | null = null;
  if (addresses.length > 0) {
    const addrSet = new Set(addresses); // already lowercased
    const { data: allContacts, error: contactErr } = await supabase.from("contacts").select("id, email");
    if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
    const contacts = (allContacts ?? []).filter(
      (c) => typeof c.email === "string" && addrSet.has(c.email.toLowerCase())
    );
    // Prefer a contact that is a property's primary contact (has a deal home).
    for (const c of contacts) {
      const { data: prop } = await supabase
        .from("properties")
        .select("id")
        .eq("primary_contact_id", c.id)
        .limit(1)
        .maybeSingle();
      contactId = c.id as number;
      if (prop) {
        propertyId = prop.id as number;
        break;
      }
    }
  }

  const sentAt = payload.Date ? new Date(payload.Date) : null;
  const row = {
    message_id: payload.MessageID ?? null,
    subject: payload.Subject ?? null,
    from_address: payload.FromFull?.Email?.toLowerCase() ?? null,
    from_name: payload.FromFull?.Name ?? null,
    to_addresses: (payload.ToFull ?? []).map((a) => a.Email ?? "").filter(Boolean),
    snippet: makeSnippet(payload),
    body_text: payload.TextBody ?? null,
    sent_at: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt.toISOString() : null,
    contact_id: contactId,
    property_id: propertyId,
    deal_id: null,
    matched: propertyId != null,
  };

  const { error: insertErr } = await supabase.from("emails").insert(row);
  if (insertErr) {
    // Duplicate MessageID (already ingested) is not an error — stay idempotent.
    if (insertErr.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, matched: row.matched, propertyId });
}
