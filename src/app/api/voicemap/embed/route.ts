import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabaseClient";
import { embedTexts, toVectorLiteral } from "@/lib/embeddings";

// Populate node-level embeddings. Finds cards whose text changed since they were
// last embedded (or were never embedded) and embeds them in batches via the
// gte-small edge function. Bounded per call — returns `remaining` so the client
// can loop until the whole corpus is indexed. Same-origin (password-gate cookie).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_CALL_CAP = 96; // cards embedded per request (keeps under the time limit)
const EDGE_BATCH = 32; // texts per edge-function call

interface NodeRow {
  id: string;
  session_id: string;
  label: string | null;
  summary: string | null;
  data: { transcript?: string | null; archived?: boolean | null } | null;
  embedding_hash: string | null;
}

// The text we embed for a card, and its hash (for change detection).
function cardText(n: NodeRow): string {
  return [n.label, n.summary, n.data?.transcript].filter((s) => s && String(s).trim()).join("\n");
}
function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function POST(req: NextRequest) {
  let body: { session_id?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — embed across all sessions
  }
  const sessionId = body?.session_id ? String(body.session_id) : null;

  let q = supabase.from("voicemap_nodes").select("id, session_id, label, summary, data, embedding_hash");
  if (sessionId) q = q.eq("session_id", sessionId);
  const nodesRes = await q;
  if (nodesRes.error) return NextResponse.json({ error: nodesRes.error.message }, { status: 500 });

  const nodes = (nodesRes.data ?? []) as NodeRow[];

  // Stale = non-archived cards whose current text hash differs from what was embedded.
  const stale: { node: NodeRow; text: string; h: string }[] = [];
  for (const n of nodes) {
    if (n.data?.archived) continue;
    const text = cardText(n);
    const h = hash(text);
    if (n.embedding_hash !== h) stale.push({ node: n, text, h });
  }

  const cap = Math.min(PER_CALL_CAP, body?.limit && body.limit > 0 ? body.limit : PER_CALL_CAP);
  const batch = stale.slice(0, cap);

  let embedded = 0;
  for (let i = 0; i < batch.length; i += EDGE_BATCH) {
    const slice = batch.slice(i, i + EDGE_BATCH);
    let vectors: number[][];
    try {
      vectors = await embedTexts(slice.map((s) => s.text));
    } catch (e) {
      return NextResponse.json(
        { error: `Embedding failed: ${(e as Error).message}`, embedded, remaining: stale.length - embedded },
        { status: 502 }
      );
    }
    const rows = slice.map((s, j) => ({
      id: s.node.id,
      session_id: s.node.session_id,
      embedding: toVectorLiteral(vectors[j]),
      embedding_hash: s.h,
    }));
    const up = await supabase.from("voicemap_nodes").upsert(rows, { onConflict: "id" });
    if (up.error) return NextResponse.json({ error: up.error.message, embedded }, { status: 500 });
    embedded += slice.length;
  }

  return NextResponse.json({ ok: true, embedded, remaining: Math.max(0, stale.length - embedded) });
}
