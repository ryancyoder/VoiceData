import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteParams = { params: Promise<{ id: string }> };

// Escapes a value for a vCard field per RFC 6350 — backslash, comma,
// semicolon, and newlines are the reserved characters.
function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

// GET returns the deal's contact as a downloadable .vcf. Served with the
// text/vcard content type so iOS/macOS open the "Add to Contacts" sheet
// instead of rendering the card as plain text.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("Sales Board")
    .select("deal_name, company, properties(address, contacts(first_name, last_name, email, phone))")
    .eq("id", Number(id))
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // PostgREST embeds a to-one relationship as an object at runtime, but the
  // generated types widen it to an array — normalize either shape to one row.
  const one = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const property = one(data.properties as unknown as RawProperty | RawProperty[] | null);
  const contact = one(property?.contacts);

  const first = contact?.first_name?.trim() || "";
  const last = contact?.last_name?.trim() || "";
  // FN (formatted name) is required — fall back to the deal name so the card
  // is never nameless.
  const fullName = [first, last].filter(Boolean).join(" ") || data.deal_name || "Contact";

  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${esc(last)};${esc(first)};;;`, `FN:${esc(fullName)}`];
  if (data.company) lines.push(`ORG:${esc(data.company)}`);
  if (contact?.phone) lines.push(`TEL;TYPE=CELL:${esc(contact.phone)}`);
  if (contact?.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(contact.email)}`);
  if (property?.address) lines.push(`ADR;TYPE=WORK:;;${esc(property.address)};;;;`);
  lines.push("END:VCARD");

  const vcard = lines.join("\r\n") + "\r\n";
  const safeName = fullName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "contact";

  return new NextResponse(vcard, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `inline; filename="${safeName}.vcf"`,
    },
  });
}

type Contact = { first_name: string | null; last_name: string | null; email: string | null; phone: string | null };
type RawProperty = { address: string | null; contacts: Contact | Contact[] | null };
