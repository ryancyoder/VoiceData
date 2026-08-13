import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  voicemapAuth,
  nodeToRow,
  VOICEMAP_CORS_HEADERS,
  type VoiceMapSyncPayload,
  type VoiceMapNode,
  type VoiceMapNodeRow,
} from "@/lib/voicemap";

// Sync endpoint for the VoiceMap PWA. See src/lib/voicemap.ts for the auth /
// CORS model. GET pulls a session's full payload; POST pushes one (authoritative
// whole-session replace, matching VoiceMap's old GitHub-Gist sync). These routes
// are excluded from the middleware password gate and guarded by VOICEMAP_SYNC_TOKEN.

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

// Pull. ?session_id=<id> returns that session; without it, the most recently
// updated session is returned (VoiceMap is effectively single-session).
export async function GET(req: NextRequest) {
  const blocked = guard(req);
  if (blocked) return blocked;

  const wanted = req.nextUrl.searchParams.get("session_id");

  let sessionRow;
  if (wanted) {
    const res = await supabase.from("voicemap_sessions").select("*").eq("id", wanted).maybeSingle();
    if (res.error) return json({ error: res.error.message }, 500);
    sessionRow = res.data;
  } else {
    const res = await supabase
      .from("voicemap_sessions")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) return json({ error: res.error.message }, 500);
    sessionRow = res.data;
  }

  if (!sessionRow) return json({ session: null, nodes: [], images: {} });

  const [nodesRes, imagesRes] = await Promise.all([
    supabase.from("voicemap_nodes").select("data").eq("session_id", sessionRow.id),
    supabase.from("voicemap_images").select("image_key, data_url").eq("session_id", sessionRow.id),
  ]);
  if (nodesRes.error) return json({ error: nodesRes.error.message }, 500);
  if (imagesRes.error) return json({ error: imagesRes.error.message }, 500);

  const nodes = (nodesRes.data ?? []).map((r) => (r as { data: VoiceMapNode }).data);
  const images: Record<string, string> = {};
  for (const row of (imagesRes.data ?? []) as { image_key: string; data_url: string }[]) {
    images[row.image_key] = row.data_url;
  }

  return json({
    session: {
      id: sessionRow.id,
      name: sessionRow.name,
      date: sessionRow.date,
      meta: sessionRow.meta ?? {},
    },
    nodes,
    images,
  });
}

// Push. Upserts the session, replaces its nodes and images (deleting any that
// are no longer present), so the server mirrors the client's session exactly.
export async function POST(req: NextRequest) {
  const blocked = guard(req);
  if (blocked) return blocked;

  let payload: VoiceMapSyncPayload;
  try {
    payload = (await req.json()) as VoiceMapSyncPayload;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const session = payload?.session;
  if (!session || !session.id) return json({ error: "session.id is required" }, 400);
  if (!Array.isArray(payload.nodes)) return json({ error: "nodes must be an array" }, 400);

  const sessionId = String(session.id);
  const syncedAt = new Date().toISOString();

  // 1) Session row.
  const meta = { ...(session.meta ?? {}), synced: syncedAt };
  const upSession = await supabase
    .from("voicemap_sessions")
    .upsert(
      {
        id: sessionId,
        name: session.name ?? null,
        date: session.date ?? null,
        meta,
        updated_at: syncedAt,
      },
      { onConflict: "id" }
    );
  if (upSession.error) return json({ error: upSession.error.message }, 500);

  // 2) Nodes — upsert all with updated_at = syncedAt, then delete any row for
  // this session whose updated_at differs (i.e. wasn't in this push). The
  // timestamp sentinel avoids building a fragile PostgREST `in (...)` filter
  // out of arbitrary node-id strings.
  const rows: VoiceMapNodeRow[] = payload.nodes
    .filter((n) => n && n.id != null)
    .map((n) => nodeToRow(n, sessionId));

  if (rows.length) {
    const upNodes = await supabase
      .from("voicemap_nodes")
      .upsert(rows.map((r) => ({ ...r, updated_at: syncedAt })), { onConflict: "id" });
    if (upNodes.error) return json({ error: upNodes.error.message }, 500);
  }
  const delNodes = await supabase
    .from("voicemap_nodes")
    .delete()
    .eq("session_id", sessionId)
    .neq("updated_at", syncedAt);
  if (delNodes.error) return json({ error: delNodes.error.message }, 500);

  // 3) Images — ONLY when the payload explicitly carries an `images` object.
  // Base64 images make the body large and can blow past Vercel's ~4.5 MB
  // request limit, so the client uploads them separately in chunks via
  // /api/voicemap/images and omits `images` here. When omitted, we leave the
  // session's existing images untouched (rather than treating "absent" as
  // "delete all"). A present object is still an authoritative replace.
  if (payload.images && typeof payload.images === "object") {
    const imageRows = Object.entries(payload.images)
      .filter(([, url]) => typeof url === "string" && url.length > 0)
      .map(([image_key, data_url]) => ({ image_key, session_id: sessionId, data_url, updated_at: syncedAt }));

    if (imageRows.length) {
      const upImages = await supabase.from("voicemap_images").upsert(imageRows, { onConflict: "image_key" });
      if (upImages.error) return json({ error: upImages.error.message }, 500);
    }
    const delImages = await supabase
      .from("voicemap_images")
      .delete()
      .eq("session_id", sessionId)
      .neq("updated_at", syncedAt);
    if (delImages.error) return json({ error: delImages.error.message }, 500);
  }

  return json({ ok: true, session_id: sessionId, synced: syncedAt });
}
