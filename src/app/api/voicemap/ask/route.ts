import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabaseClient";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

// Hybrid RAG chat over VoiceMap notes. For a question we retrieve the most
// relevant CARDS (detail, via node embeddings) plus the wiki pages of the
// topics those cards belong to (overview), then let Claude answer grounded in
// that context with numbered citations. `whole-brain` mode skips retrieval and
// reasons over every wiki page (the compressed whole-corpus view) — better for
// global "what are all my themes" questions.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-5";
const TOP_CARDS = 12;
const MAX_TOPIC_PAGES = 4;
const PAGE_TRUNC = 1500;

let anthropic: Anthropic | null = null;
const getAnthropic = () => (anthropic ??= new Anthropic());

interface MatchCard {
  id: string;
  session_id: string;
  label: string | null;
  summary: string | null;
  parent_id: string | null;
  distance: number;
}
interface Source {
  n: number;
  label: string;
  topic_node_id: string | null;
  kind: "card" | "topic";
}
type HistoryMsg = { role: "user" | "assistant"; content: string };

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

// Resolve each card's root topic id (cycle-guarded) from the session's tree.
async function resolveTopics(cards: MatchCard[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const sessions = [...new Set(cards.map((c) => c.session_id))];
  if (!sessions.length) return out;
  const res = await supabase.from("voicemap_nodes").select("id, parent_id").in("session_id", sessions);
  if (res.error) return out;
  const parent = new Map<string, string | null>();
  const ids = new Set<string>();
  for (const n of (res.data ?? []) as { id: string; parent_id: string | null }[]) {
    parent.set(n.id, n.parent_id);
    ids.add(n.id);
  }
  for (const c of cards) {
    let cur = c.id;
    const seen = new Set<string>();
    while (true) {
      const p = parent.get(cur);
      if (!p || !ids.has(p) || seen.has(p)) break;
      seen.add(p);
      cur = p;
    }
    out.set(c.id, cur);
  }
  return out;
}

export async function POST(req: NextRequest) {
  let body: { question?: string; history?: HistoryMsg[]; mode?: string; session_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });
  const sessionId = body.session_id ? String(body.session_id) : null;
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];

  let contextBlock = "";
  const sources: Source[] = [];

  const wholeBrain = body.mode === "whole-brain";
  let usedWholeBrain = wholeBrain;

  if (wholeBrain) {
    let q = supabase.from("voicemap_wiki_pages").select("topic_node_id, title, content").order("updated_at", { ascending: false });
    if (sessionId) q = q.eq("session_id", sessionId);
    const pagesRes = await q.limit(40);
    if (pagesRes.error) return NextResponse.json({ error: pagesRes.error.message }, { status: 500 });
    const pages = (pagesRes.data ?? []) as { topic_node_id: string; title: string; content: string }[];
    if (pages.length) {
      const lines = pages.map((p, i) => {
        sources.push({ n: i + 1, label: p.title, topic_node_id: p.topic_node_id, kind: "topic" });
        return `[${i + 1}] TOPIC "${p.title}":\n${trunc(p.content, PAGE_TRUNC)}`;
      });
      contextBlock = lines.join("\n\n");
    } else {
      usedWholeBrain = false; // no wiki pages yet — fall back to retrieval
    }
  }

  if (!usedWholeBrain) {
    // Retrieve relevant cards via node embeddings.
    let vec: number[];
    try {
      vec = await embedText(question);
    } catch (e) {
      return NextResponse.json({ error: `Embedding failed: ${(e as Error).message}` }, { status: 502 });
    }
    const rpc = await supabase.rpc("voicemap_match_nodes", {
      p_query: toVectorLiteral(vec),
      p_limit: TOP_CARDS,
      p_session: sessionId,
    });
    if (rpc.error) return NextResponse.json({ error: rpc.error.message }, { status: 500 });
    const cards = (rpc.data ?? []) as MatchCard[];

    if (!cards.length) {
      return NextResponse.json({
        answer:
          "I don't have any indexed notes to answer from yet. Capture some cards in VoiceMap, then hit **Reindex cards** on the wiki page so they're searchable.",
        sources: [],
      });
    }

    const topics = await resolveTopics(cards);

    // Topic overviews (wiki pages) for the topics the top cards belong to.
    const topicIds = [...new Set([...topics.values()])].slice(0, MAX_TOPIC_PAGES);
    const topicLabel = new Map<string, string>();
    let overviews = "";
    if (topicIds.length) {
      const pRes = await supabase
        .from("voicemap_wiki_pages")
        .select("topic_node_id, title, content")
        .in("topic_node_id", topicIds);
      if (!pRes.error) {
        const pages = (pRes.data ?? []) as { topic_node_id: string; title: string; content: string }[];
        for (const p of pages) topicLabel.set(p.topic_node_id, p.title);
        if (pages.length) {
          overviews =
            "TOPIC OVERVIEWS (synthesized):\n" +
            pages.map((p) => `## ${p.title}\n${trunc(p.content, PAGE_TRUNC)}`).join("\n\n") +
            "\n\n";
        }
      }
    }

    const cardLines = cards.map((c, i) => {
      const topicId = topics.get(c.id) ?? null;
      sources.push({ n: i + 1, label: c.label ?? "(untitled)", topic_node_id: topicId, kind: "card" });
      const t = topicId ? topicLabel.get(topicId) : undefined;
      return `[${i + 1}]${t ? ` (topic: ${t})` : ""} ${c.label ?? "(untitled)"}${c.summary ? `: ${c.summary}` : ""}`;
    });
    contextBlock = `${overviews}SOURCES (cards):\n${cardLines.join("\n")}`;
  }

  const system = [
    "You are the user's personal second brain, answering questions from THEIR captured notes.",
    "Answer using ONLY the provided context. If the answer isn't in it, say you don't have a note on that — do not use outside knowledge.",
    "Cite the sources that support each claim inline as [n], matching the numbered SOURCES/TOPIC items.",
    "Be concise and direct. Use Markdown. It's fine to note connections or gaps you notice across the sources.",
  ].join("\n");

  const messages = [
    ...history.map((m) => ({ role: m.role, content: String(m.content) })),
    { role: "user" as const, content: `CONTEXT:\n${contextBlock}\n\nQUESTION: ${question}` },
  ];

  let answer = "";
  try {
    const resp = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
    });
    answer = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
  } catch (e) {
    return NextResponse.json({ error: `Answer failed: ${(e as Error).message}` }, { status: 502 });
  }

  return NextResponse.json({ answer, sources, mode: usedWholeBrain ? "whole-brain" : "focused" });
}
