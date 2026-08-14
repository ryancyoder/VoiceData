import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

// Semantic search over cards — proves the node-embedding chain end to end. Embeds
// the query with gte-small and finds nearest cards via the voicemap_match_nodes
// RPC. Results link to their top-level topic's wiki page.
export const dynamic = "force-dynamic";

interface Match {
  id: string;
  session_id: string;
  label: string | null;
  summary: string | null;
  parent_id: string | null;
  distance: number;
}

// Resolve each match's root ancestor (its topic), so results can link to the
// topic wiki page. Cycle-guarded.
async function rootTopicIds(matches: Match[]): Promise<Map<string, string>> {
  const sessions = [...new Set(matches.map((m) => m.session_id))];
  const rootByNode = new Map<string, string>();
  if (!sessions.length) return rootByNode;

  const res = await supabase.from("voicemap_nodes").select("id, parent_id, session_id").in("session_id", sessions);
  if (res.error) return rootByNode;
  const parent = new Map<string, string | null>();
  const ids = new Set<string>();
  for (const n of (res.data ?? []) as { id: string; parent_id: string | null }[]) {
    parent.set(n.id, n.parent_id);
    ids.add(n.id);
  }
  for (const m of matches) {
    let cur = m.id;
    const seen = new Set<string>();
    while (true) {
      const p = parent.get(cur);
      if (!p || !ids.has(p) || seen.has(p)) break;
      seen.add(p);
      cur = p;
    }
    rootByNode.set(m.id, cur);
  }
  return rootByNode;
}

export default async function VoiceMapSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  let matches: Match[] = [];
  let roots = new Map<string, string>();
  let error: string | null = null;

  if (query) {
    try {
      const vec = await embedText(query);
      const rpc = await supabase.rpc("voicemap_match_nodes", { p_query: toVectorLiteral(vec), p_limit: 20 });
      if (rpc.error) throw new Error(rpc.error.message);
      matches = (rpc.data ?? []) as Match[];
      roots = await rootTopicIds(matches);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Search cards</h1>
        <Link href="/voicemap/wiki" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          Wiki
        </Link>
      </header>

      <form action="/voicemap/search" method="get" className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={query}
          autoFocus
          placeholder="Search by meaning, not just keywords…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Search failed: {error}</p>}

      {!query ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Finds cards by meaning across everything you&apos;ve captured. Tip: run{" "}
          <span className="font-medium">Reindex cards</span> on the wiki page first so new cards are searchable.
        </p>
      ) : !error && matches.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No matches. If you just added cards, reindex them from the wiki page.
        </p>
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => {
            const topic = roots.get(m.id);
            const inner = (
              <div className="rounded-lg border border-zinc-200 bg-white p-3 transition-colors hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-800">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.label || "(untitled)"}</div>
                {m.summary && <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{m.summary}</p>}
              </div>
            );
            return (
              <li key={m.id}>
                {topic ? (
                  <Link href={`/voicemap/wiki/${encodeURIComponent(topic)}`}>{inner}</Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
