import { supabase } from "@/lib/supabaseClient";

// Simple key/value app settings, stored in the app_settings table.
export const OUTLOOK_ICS_KEY = "outlook_ics_url";

// How strongly the read-only Outlook overlay is drawn on the Calendar, as a
// percentage. The overlay competes with real events for attention, so this
// dials it back. 100 = today's appearance, which is the default so the setting
// changes nothing until it's deliberately turned down.
export const OUTLOOK_OPACITY_KEY = "calendar_outlook_opacity";
export const OUTLOOK_OPACITY_DEFAULT = 100;
export const OUTLOOK_OPACITY_MIN = 10;
export const OUTLOOK_OPACITY_MAX = 100;

// Sales Board view option: hovering a deal card shows that deal's property
// "key photo" (properties.cover_photo_id — the same album cover the deal modal
// puts in its header). Off unless explicitly turned on.
export const SALES_BOARD_HOVER_PHOTO_KEY = "sales_board_hover_property_photo";

// Where that preview is drawn. Off = a floating box beside the hovered card;
// on = a full-height pane pinned after the last stage column. Only meaningful
// while SALES_BOARD_HOVER_PHOTO_KEY is on.
export const SALES_BOARD_HOVER_PHOTO_WIDE_KEY = "sales_board_hover_property_photo_wide";

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

// Numeric settings ride the same string column. Anything unparseable — an unset
// key, a value left over from another shape — reads as the caller's fallback,
// and everything is clamped, so a bad stored value can never produce an
// out-of-range result downstream.
export async function getNumberSetting(
  key: string,
  fallback: number,
  min: number,
  max: number
): Promise<number> {
  const raw = await getSetting(key);
  const parsed = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export async function setNumberSetting(
  key: string,
  value: number,
  min: number,
  max: number
): Promise<{ error: string | null }> {
  const clamped = Math.min(max, Math.max(min, Math.round(value)));
  return setSetting(key, String(clamped));
}

export async function setFlagSetting(key: string, on: boolean): Promise<{ error: string | null }> {
  // Off is stored as null rather than "0" so setSetting's empty-string
  // normalization and a cleared row mean the same thing.
  return setSetting(key, on ? "1" : null);
}
