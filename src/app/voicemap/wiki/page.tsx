import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { topicRootNodes, gatherTopicCards, hashCards, newCardsSince, type WikiNode } from "@/lib/voicemapWiki";
import WikiRebuild from "./WikiRebuild";
import ReindexCards from "../ReindexCards";

// Index of the adaptive wiki: every top-level VoiceMap topic, with whether its
// page is built, up to date, or has new cards since the last rebuild.
export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  name: string | null;
  updated_at: string | null;
}
interface WikiPageRow {
  session_id: string;
  topic_node_id: string;
  title: string;
  source_hash: string | null;
  source_card_count: number;
  version: number;
  built_at: string | null;
}

export default async function WikiIndexPage() {
  const [sessionsRes, nodesRes, pagesRes] = await Promise.all([
    supabase.from("voicemap_sessions").select("id, name, updated_at").order("updated_at", { ascending: false }),
    supabase.from("voicemap_nodes").select("id, session_id, parent_id, label, summary, status, data, last_modified"),
    supabase.from("voicemap_wiki_pages").select("session_id, topic_node_id, title, source_hash, source_card_count, version, built_at"),
  ]);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);
  if (nodesRes.error) throw new Error(nodesRes.error.message);
  if (pagesRes.error) throw new Error(pagesRes.error.message);

  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  const allNodes = (nodesRes.data ?? []) as (WikiNode & { session_id: string })[];
  const pages = (pagesRes.data ?? []) as WikiPageRow[];

  const nodesBySession = new Map<string, WikiNode[]>();
  for (const n of allNodes) {
    const list = nodesBySession.get(n.session_id) ?? [];
    list.push(n);
    nodesBySession.set(n.session_id, list);
  }
  const pageKey = (s: string, t: string) => `${s}::${t}`;
  const pageMap = new Map<string, WikiPageRow>();
  for (const p of pages) pageMap.set(pageKey(p.session_id, p.topic_node_id), p);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">VoiceMap Wiki</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Living articles synthesized from your captured ideas. Rebuild a topic to fold in new cards.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/voicemap/ask"
              className="rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Ask
            </Link>
            <Link
              href="/voicemap/search"
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Search
            </Link>
            <Link
              href="/voicemap/organize"
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Organize
            </Link>
            <Link
              href="/voicemap"
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cards view
            </Link>
          </div>
        </div>
        <div className="mt-3">
          <ReindexCards />
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Reindex to make newly-synced cards searchable and power semantic features.
          </p>
        </div>
      </header>

      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No VoiceMap data yet.</p>
      ) : (
        <div className="space-y-8">
          {sessions.map((session) => {
            const nodes = nodesBySession.get(session.id) ?? [];
            const topics = topicRootNodes(nodes);
            if (!topics.length) return null;
            return (
              <section key={session.id}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
                    {session.name || "Untitled session"}
                  </h2>
                  <WikiRebuild
                    sessionId={session.id}
                    all
                    label="Rebuild all"
                    className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  />
                </div>
                <ul className="space-y-2">
                  {topics.map((topic) => {
                    const cards = gatherTopicCards(nodes, topic.id);
                    const page = pageMap.get(pageKey(session.id, topic.id));
                    const built = !!page;
                    const stale = built && page!.source_hash !== hashCards(cards);
                    const newCount = built ? newCardsSince(cards, page!.built_at) : cards.length;
                    return (
                      <li
                        key={topic.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {built ? (
                              <Link
                                href={`/voicemap/wiki/${encodeURIComponent(topic.id)}`}
                                className="truncate text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                              >
                                {page!.title || topic.label || "(untitled)"}
                              </Link>
                            ) : (
                              <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                {topic.label || "(untitled)"}
                              </span>
                            )}
                            {!built && (
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                not built
                              </span>
                            )}
                            {stale && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                {newCount > 0 ? `${newCount} new card${newCount === 1 ? "" : "s"}` : "cards changed"}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                            {cards.length} card{cards.length === 1 ? "" : "s"}
                            {built ? ` · v${page!.version}` : ""}
                          </div>
                        </div>
                        <WikiRebuild sessionId={session.id} topicNodeId={topic.id} label={built ? "Rebuild" : "Build"} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
