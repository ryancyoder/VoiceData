import { supabase } from "@/lib/supabaseClient";

// Simple key/value app settings, stored in the app_settings table.
export const OUTLOOK_ICS_KEY = "outlook_ics_url";

export async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) return null;
  const v = data?.value ?? null;
  return v && v.trim() ? v.trim() : null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await supabase
    .from("app_settings")
    .upsert({ key, value: value && value.trim() ? value.trim() : null, updated_at: new Date().toISOString() });
}
