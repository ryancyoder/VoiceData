import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  topicRootNodes,
  gatherTopicCards,
  hashCards,
  synthesizeWikiPage,
  type WikiNode,
} from "@/lib/voicemapWiki";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

// Rebuild one wiki page (or all pages in a session) by re-synthesizing the
// current cards. Same-origin, so it rides the app's password-gate cookie — no
// extra auth here. Each rebuild bumps the page version and snapshots history.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // synthesis can take a few seconds per topic

const NODE_COLS = "id, parent_id, label, summary, status, data, last_modified";

export async function POST(req: NextRequest) {
  let body: { session_id?: string; topic_node_id?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sessionId = body?.session_id ? String(body.session_id) : "";
  if (!sessionId) return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  if (!body.all && !body.topic_node_id) {
    return NextResponse.json({ error: "topic_node_id or all is required" }, { status: 400 });
  }

  const nodesRes = await supabase.from("voicemap_nodes").select(NODE_COLS).eq("session_id", sessionId);
  if (nodesRes.error) return NextResponse.json({ error: nodesRes.error.message }, { status: 500 });
  const nodes = (nodesRes.data ?? []) as WikiNode[];

  const roots = topicRootNodes(nodes);
  const siblingTitles = roots.map((r) => r.label ?? "").filter(Boolean);

  const targets: WikiNode[] = body.all
    ? roots
    : roots.filter((r) => r.id === body.topic_node_id).length
      ? roots.filter((r) => r.id === body.topic_node_id)
      : nodes.filter((n) => n.id === body.topic_node_id); // allow a non-root anchor too

  if (!targets.length) return NextResponse.json({ error: "topic not found" }, { status: 404 });

  const rebuilt: { topic_node_id: string; title: string; version: number; cards: number }[] = [];

  for (const topic of targets) {
    const cards = gatherTopicCards(nodes, topic.id);
    const topicTitle = topic.label ?? "Untitled topic";

    let synth;
    try {
      synth = await synthesizeWikiPage({ topicTitle, cards, siblingTitles });
    } catch (e) {
      return NextResponse.json(
        { error: `Synthesis failed for "${topicTitle}": ${(e as Error).message}`, rebuilt },
        { status: 502 }
      );
    }

    const source_hash = hashCards(cards);
    const now = new Date().toISOString();

    // Best-effort embedding of the synthesized page for semantic "related
    // topics". Never fail the rebuild over this — if it errors (e.g. no OpenAI
    // key), the page just won't participate in related-topic matching.
    let embedding: string | null = null;
    try {
      const vec = await embedText(`${synth.title}\n\n${synth.markdown}`);
      embedding = toVectorLiteral(vec);
    } catch {
      embedding = null;
    }

    // Next version number for this page.
    const existing = await supabase
      .from("voicemap_wiki_pages")
      .select("id, version")
      .eq("session_id", sessionId)
      .eq("topic_node_id", topic.id)
      .maybeSingle();
    if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
    const version = (existing.data?.version ?? 0) + 1;

    const up = await supabase
      .from("voicemap_wiki_pages")
      .upsert(
        {
          session_id: sessionId,
          topic_node_id: topic.id,
          title: synth.title,
          content: synth.markdown,
          source_hash,
          source_card_count: cards.length,
          version,
          built_at: now,
          updated_at: now,
          // Omit when embedding failed so we don't null out a prior vector.
          ...(embedding ? { embedding } : {}),
        },
        { onConflict: "session_id,topic_node_id" }
      )
      .select("id")
      .single();
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    const ver = await supabase.from("voicemap_wiki_versions").insert({
      page_id: up.data.id,
      version,
      title: synth.title,
      content: synth.markdown,
      source_hash,
      source_card_count: cards.length,
    });
    if (ver.error) return NextResponse.json({ error: ver.error.message }, { status: 500 });

    rebuilt.push({ topic_node_id: topic.id, title: synth.title, version, cards: cards.length });
  }

  return NextResponse.json({ ok: true, rebuilt });
}
