import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { voicemapAuth, VOICEMAP_CORS_HEADERS } from "@/lib/voicemap";

// Image sync for VoiceMap, split out from /api/voicemap/sync because base64
// images make a single whole-session POST large enough to hit Vercel's ~4.5 MB
// request-body limit. The client uploads images here in size-bounded chunks
// (no delete per chunk), then sends one final `keepKeys` prune to drop images
// that were removed. Same token auth + CORS as the sync route.

function cors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(VOICEMAP_CORS_HEADERS)) res.headers.set(k, v);
  return res;
}
function json(body: unknown, status = 200): NextResponse {
  return cors(NextResponse.json(body, { status }));
}
function guard(req: NextRequest): NextResponse | null {
  const { ok, configured } = voicemapAuth(req);
  if (!configured) return json({ error: "VOICEMAP_SYNC_TOKEN is not configured on the server." }, 503);
  if (!ok) return json({ error: "Unauthorized" }, 401);
  return null;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

interface ImagesBody {
  session_id?: string;
  // A chunk of images to upsert (image_key -> base64 data URL).
  images?: Record<string, string>;
  // When present, delete every image for the session whose key is NOT listed —
  // the client sends this once, last, to reflect deletions.
  keepKeys?: string[];
}

export async function POST(req: NextRequest) {
  const blocked = guard(req);
  if (blocked) return blocked;

  let body: ImagesBody;
  try {
    body = (await req.json()) as ImagesBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const sessionId = body?.session_id ? String(body.session_id) : "";
  if (!sessionId) return json({ error: "session_id is required" }, 400);

  // Upsert a chunk of images (no delete — pruning is a separate final call).
  if (body.images && typeof body.images === "object") {
    const rows = Object.entries(body.images)
      .filter(([, url]) => typeof url === "string" && url.length > 0)
      .map(([image_key, data_url]) => ({ image_key, session_id: sessionId, data_url, updated_at: new Date().toISOString() }));
    if (rows.length) {
      const up = await supabase.from("voicemap_images").upsert(rows, { onConflict: "image_key" });
      if (up.error) return json({ error: up.error.message }, 500);
    }
    return json({ ok: true, upserted: rows.length });
  }

  // Prune: delete images for this session that aren't in keepKeys. We read the
  // existing keys and delete the difference with `.in()` (which encodes the
  // array safely) rather than hand-building a PostgREST `in (...)` string.
  if (Array.isArray(body.keepKeys)) {
    const keep = new Set(body.keepKeys.map(String));
    const existing = await supabase.from("voicemap_images").select("image_key").eq("session_id", sessionId);
    if (existing.error) return json({ error: existing.error.message }, 500);
    const toDelete = (existing.data ?? [])
      .map((r) => (r as { image_key: string }).image_key)
      .filter((k) => !keep.has(k));
    if (toDelete.length) {
      const del = await supabase.from("voicemap_images").delete().eq("session_id", sessionId).in("image_key", toDelete);
      if (del.error) return json({ error: del.error.message }, 500);
    }
    return json({ ok: true, deleted: toDelete.length });
  }

  return json({ error: "Provide either `images` (a chunk) or `keepKeys` (a prune list)." }, 400);
}
