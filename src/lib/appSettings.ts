import { supabase } from "@/lib/supabaseClient";

// Simple key/value app settings, stored in the app_settings table.
export const OUTLOOK_ICS_KEY = "outlook_ics_url";

// Sales Board view option: hovering a deal card shows that deal's property
// "key photo" (properties.cover_photo_id — the same album cover the deal modal
// puts in its header) as a floating preview. Off unless explicitly turned on.
export const SALES_BOARD_HOVER_PHOTO_KEY = "sales_board_hover_property_photo";

export async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) return null;
  const v = data?.value ?? null;
  return v && v.trim() ? v.trim() : null;
}

// Returns the write error rather than throwing, so a caller can tell a real
// save from a silently dropped one. Existing callers that ignore the result
// keep their previous fire-and-forget behavior.
export async function setSetting(key: string, value: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value: value && value.trim() ? value.trim() : null, updated_at: new Date().toISOString() });
  return { error: error?.message ?? null };
}

// On/off settings ride the same string column. "1" is the only truthy value, so
// an unset key (or a value left over from some other shape) reads as off —
// which keeps every toggle opt-in rather than silently defaulting to on.
export async function getFlagSetting(key: string): Promise<boolean> {
  return (await getSetting(key)) === "1";
}

export async function setFlagSetting(key: string, on: boolean): Promise<{ error: string | null }> {
  // Off is stored as null rather than "0" so setSetting's empty-string
  // normalization and a cleared row mean the same thing.
  return setSetting(key, on ? "1" : null);
}
