import type { NextRequest } from "next/server";

// ─── VoiceMap shared data model ──────────────────────────────────────────────
// VoiceMap is a serverless PWA. It can't reach the locked-down Supabase project
// directly (the anon key has no access), so it syncs through the server routes
// under /api/voicemap, which use the service-role client. Those routes sit
// OUTSIDE the password-cookie gate (the middleware matcher excludes them) and
// are instead protected by a shared bearer token (VOICEMAP_SYNC_TOKEN), so the
// cross-origin PWA can authenticate without the browser session cookie.

// A VoiceMap card. The schema is intentionally loose — VoiceMap's node shape
// evolves and the full object is round-tripped through the `data` jsonb column.
export interface VoiceMapNode {
  id: string;
  parent_id?: string | null;
  label?: string | null;
  summary?: string | null;
  status?: string | null;
  last_modified?: string | null;
  [key: string]: unknown;
}

export interface VoiceMapSessionMeta {
  id: string;
  name?: string | null;
  date?: string | null;
  meta?: Record<string, unknown>;
}

// The payload VoiceMap pushes and pulls. `images` maps an image key
// (a node id, or `g:nodeId:index` for gallery images) to a base64 data URL.
export interface VoiceMapSyncPayload {
  session: VoiceMapSessionMeta;
  nodes: VoiceMapNode[];
  images: Record<string, string>;
}

// Rows as stored in Supabase.
export interface VoiceMapNodeRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  label: string | null;
  summary: string | null;
  status: string | null;
  data: VoiceMapNode;
  last_modified: string | null;
}

// True when the request carries the shared sync token. Returns `null` when the
// token isn't configured on the server (the routes then report 503) so we can
// distinguish "not set up" from "wrong token".
export function voicemapAuth(req: NextRequest): { ok: boolean; configured: boolean } {
  const expected = process.env.VOICEMAP_SYNC_TOKEN;
  if (!expected) return { ok: false, configured: false };
  const header = req.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  // Length-then-value compare; fine for a shared personal-scope secret.
  return { ok: provided.length > 0 && provided === expected, configured: true };
}

// CORS headers — the routes are called cross-origin from the VoiceMap PWA.
// Auth is via the bearer token (not cookies), so a wildcard origin is safe and
// avoids having to enumerate every device/host VoiceMap runs on.
export const VOICEMAP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
};

// Promote the queryable columns out of a full node object for storage.
export function nodeToRow(node: VoiceMapNode, sessionId: string): VoiceMapNodeRow {
  return {
    id: String(node.id),
    session_id: sessionId,
    parent_id: node.parent_id != null ? String(node.parent_id) : null,
    label: node.label != null ? String(node.label) : null,
    summary: node.summary != null ? String(node.summary) : null,
    status: node.status != null ? String(node.status) : null,
    data: node,
    last_modified: node.last_modified != null ? String(node.last_modified) : null,
  };
}
