import { supabase } from "@/lib/supabaseClient";

export interface ContactInput {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

function isEmptyContact(input: ContactInput): boolean {
  return !input.first_name && !input.last_name && !input.email && !input.phone;
}

/**
 * Sets a property's primary contact — a property has exactly one, but a
 * contact may be primary for more than one property, so this updates the
 * existing contacts row in place (affecting every property that shares it)
 * rather than ever creating a duplicate. Creates a new contact and links it
 * only when the property doesn't have one yet. A no-op when every field is
 * empty, since there's nothing to save.
 */
export async function upsertPropertyContact(propertyId: number, input: ContactInput): Promise<void> {
  if (isEmptyContact(input)) return;

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("primary_contact_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (propertyError) throw new Error(propertyError.message);

  if (property?.primary_contact_id != null) {
    const { error } = await supabase
      .from("contacts")
      .update({ first_name: input.first_name, last_name: input.last_name, email: input.email, phone: input.phone })
      .eq("id", property.primary_contact_id);
    if (error) throw new Error(error.message);
    return;
  }

  const { data: contact, error: insertError } = await supabase
    .from("contacts")
    .insert({ first_name: input.first_name, last_name: input.last_name, email: input.email, phone: input.phone })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  const { error: linkError } = await supabase
    .from("properties")
    .update({ primary_contact_id: contact.id })
    .eq("id", propertyId);
  if (linkError) throw new Error(linkError.message);
}
