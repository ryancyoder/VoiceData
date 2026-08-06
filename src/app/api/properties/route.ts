import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { findOrCreateProperty } from "@/lib/properties";
import { upsertPropertyContact } from "@/lib/contacts";

// Creates (or finds, if the address already exists) a property row, with an
// optional primary contact set in the same call — used both by the photo
// import "add a new property" flow (address only) and the Properties page's
// add-property form (address + contact together).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    address?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    email?: unknown;
    phone?: unknown;
  };
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const property = await findOrCreateProperty(address);
    if (!property) {
      return NextResponse.json({ error: "Failed to create property" }, { status: 500 });
    }

    const contactInput = {
      first_name: typeof body.first_name === "string" ? body.first_name.trim() || null : null,
      last_name: typeof body.last_name === "string" ? body.last_name.trim() || null : null,
      email: typeof body.email === "string" ? body.email.trim() || null : null,
      phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
    };

    if (contactInput.first_name || contactInput.last_name || contactInput.email || contactInput.phone) {
      await upsertPropertyContact(property.id, contactInput);
    }

    const { data: withContact, error: fetchError } = await supabase
      .from("properties")
      .select("*, contacts(*)")
      .eq("id", property.id)
      .single();
    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // Rename Supabase's embed key (contacts, the table name) to the shape
    // consumers actually use (contact, singular — a property has one).
    const { contacts, ...propertyFields } = withContact as typeof withContact & { contacts: unknown };
    return NextResponse.json({ property: { ...propertyFields, contact: contacts ?? null } }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create property" },
      { status: 500 }
    );
  }
}
