import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import {
  topicRootNodes,
  gatherTopicCards,
  hashCards,
  newCardsSince,
  resolveWikiLinks,
  type WikiNode,
} from "@/lib/voicemapWiki";
import WikiMarkdown from "../WikiMarkdown";
import WikiRebuild from "../WikiRebuild";

export const dynamic = "force-dynamic";

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default async function WikiArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ topic: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { topic } = await params;
  const { v } = await searchParams;
  const topicNodeId = decodeURIComponent(topic);

  const nodeRes = await supabase
    .from("voicemap_nodes")
    .select("id, session_id, label")
    .eq("id", topicNodeId)
    .maybeSingle();
  if (nodeRes.error) throw new Error(nodeRes.error.message);

  const anchor = nodeRes.data as { id: string; session_id: string; label: string | null } | null;
  if (!anchor) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <Link href="/voicemap/wiki" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Wiki
        </Link>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">This topic no longer exists.</p>
      </main>
    );
  }
  const sessionId = anchor.session_id;

  const [nodesRes, pageRes] = await Promise.all([
    supabase
      .from("voicemap_nodes")
      .select("id, session_id, parent_id, label, summary, status, data, last_modified")
      .eq("session_id", sessionId),
    supabase
      .from("voicemap_wiki_pages")
      .select("id, title, content, source_hash, version, built_at")
      .eq("session_id", sessionId)
      .eq("topic_node_id", topicNodeId)
      .maybeSingle(),
  ]);
  if (nodesRes.error) throw new Error(nodesRes.error.message);
  if (pageRes.error) throw new Error(pageRes.error.message);

  const nodes = (nodesRes.data ?? []) as WikiNode[];
  const page = pageRes.data as
    | { id: number; title: string; content: string; source_hash: string | null; version: number; built_at: string | null }
    | null;

  const cards = gatherTopicCards(nodes, topicNodeId);

  // Title -> page href for [[wikilink]] resolution.
  const titleToHref = new Map<string, string>();
  for (const t of topicRootNodes(nodes)) {
    if (t.label) titleToHref.set(t.label, `/voicemap/wiki/${encodeURIComponent(t.id)}`);
  }

  // Version history + which version to display.
  let displayTitle = page?.title ?? anchor.label ?? "Untitled topic";
  let displayContent = page?.content ?? "";
  let displayVersion = page?.version ?? 0;
  let versions: { version: number; created_at: string }[] = [];

  if (page) {
    const vRes = await supabase
      .from("voicemap_wiki_versions")
      .select("version, created_at, title, content")
      .eq("page_id", page.id)
      .order("version", { ascending: false });
    if (vRes.error) throw new Error(vRes.error.message);
    const all = (vRes.data ?? []) as { version: number; created_at: string; title: string; content: string }[];
    versions = all.map((r) => ({ version: r.version, created_at: r.created_at }));
    const wanted = v ? parseInt(v, 10) : NaN;
    if (!isNaN(wanted)) {
      const hit = all.find((r) => r.version === wanted);
      if (hit) {
        displayTitle = hit.title;
        displayContent = hit.content;
        displayVersion = hit.version;
      }
    }
  }

  // Semantically related pages (pgvector). Only when this page has an embedding
  // and there are other embedded pages in the session; empty otherwise.
  let related: { topic_node_id: string; title: string }[] = [];
  if (page) {
    const relRes = await supabase.rpc("voicemap_related_pages", { p_page_id: page.id, p_limit: 5 });
    if (!relRes.error && Array.isArray(relRes.data)) {
      related = (relRes.data as { topic_node_id: string; title: string }[]).map((r) => ({
        topic_node_id: r.topic_node_id,
        title: r.title,
      }));
    }
  }

  const isCurrent = !page || displayVersion === page.version;
  const stale = page ? page.source_hash !== hashCards(cards) : false;
  const newCount = page ? newCardsSince(cards, page.built_at) : cards.length;
  const rendered = resolveWikiLinks(displayContent, titleToHref);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/voicemap/wiki" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Wiki
        </Link>
        <WikiRebuild sessionId={sessionId} topicNodeId={topicNodeId} label={page ? "Rebuild" : "Build"} />
      </div>

      <header className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{displayTitle}</h1>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          {cards.length} source card{cards.length === 1 ? "" : "s"}
          {page ? ` · v${displayVersion}${isCurrent ? " (current)" : ""} · built ${fmt(page.built_at)}` : " · not yet built"}
        </p>
      </header>

      {stale && isCurrent && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <span>
            {newCount > 0
              ? `${newCount} new or changed card${newCount === 1 ? "" : "s"} since this was built.`
              : "The underlying cards changed since this was built."}
          </span>
          <WikiRebuild
            sessionId={sessionId}
            topicNodeId={topicNodeId}
            label="Rebuild now"
            className="shrink-0 rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          />
        </div>
      )}

      {!isCurrent && (
        <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Viewing version {displayVersion}.{" "}
          <Link href={`/voicemap/wiki/${encodeURIComponent(topicNodeId)}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
            Back to current
          </Link>
        </div>
      )}

      {page ? (
        <article>
          <WikiMarkdown markdown={rendered} />
        </article>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <p className="mb-3">This topic hasn&apos;t been synthesized yet. Build it to generate a wiki page from its {cards.length} card{cards.length === 1 ? "" : "s"}.</p>
          <WikiRebuild sessionId={sessionId} topicNodeId={topicNodeId} label="Build page" />
        </div>
      )}

      {page && related.length > 0 && (
        <section className="mt-8 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Related topics
          </h2>
          <ul className="flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.topic_node_id}>
                <Link
                  href={`/voicemap/wiki/${encodeURIComponent(r.topic_node_id)}`}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:border-zinc-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {versions.length > 1 && (
        <footer className="mt-8 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">History</h2>
          <ul className="flex flex-wrap gap-2">
            {versions.map((ver) => {
              const active = ver.version === displayVersion;
              return (
                <li key={ver.version}>
                  <Link
                    href={`/voicemap/wiki/${encodeURIComponent(topicNodeId)}?v=${ver.version}`}
                    className={`rounded-full px-2.5 py-1 text-xs ${
                      active
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                    title={fmt(ver.created_at)}
                  >
                    v{ver.version}
                  </Link>
                </li>
              );
            })}
          </ul>
        </footer>
      )}
    </main>
  );
}
