import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { suggestHomes, parseEmbedding, type OrgNode } from "@/lib/voicemapOrganize";

// "Suggested homes": loose root-level cards (new captures that never got filed)
// with the established topic they're semantically closest to. Advisory — because
// VoiceMap syncs authoritatively, the actual move is done there; this just tells
// you where each card wants to live.
export const dynamic = "force-dynamic";

interface RawNode {
  id: string;
  parent_id: string | null;
  session_id: string;
  label: string | null;
  summary: string | null;
  data: { archived?: boolean | null } | null;
  embedding: unknown;
}

export default async function OrganizePage() {
  const res = await supabase
    .from("voicemap_nodes")
    .select("id, parent_id, session_id, label, summary, data, embedding");
  if (res.error) throw new Error(res.error.message);

  const rows = (res.data ?? []) as RawNode[];
  const anyEmbedded = rows.some((r) => parseEmbedding(r.embedding));
  const nodes: OrgNode[] = rows.map((r) => ({
    id: r.id,
    parent_id: r.parent_id,
    session_id: r.session_id,
    label: r.label,
    summary: r.summary,
    archived: !!r.data?.archived,
    embedding: parseEmbedding(r.embedding),
  }));

  const suggestions = suggestHomes(nodes);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Suggested homes</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Loose cards and where they seem to belong. Make the move in VoiceMap.
          </p>
        </div>
        <Link href="/voicemap/wiki" className="shrink-0 text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          Wiki
        </Link>
      </header>

      {!anyEmbedded ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No embedded cards yet. Run <span className="font-medium">Reindex cards</span> on the wiki page first.
        </p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Nothing loose — every top-level card either is a topic or already has a home. 🎉
        </p>
      ) : (
        <ul className="space-y-3">
          {suggestions.map((s) => (
            <li
              key={s.card.id}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{s.card.label}</div>
              {s.card.summary && (
                <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{s.card.summary}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-400 dark:text-zinc-500">File under:</span>
                {s.suggestions.map((sug, i) => (
                  <Link
                    key={sug.topic_id}
                    href={`/voicemap/wiki/${encodeURIComponent(sug.topic_id)}`}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      i === 0
                        ? "bg-indigo-600 text-white hover:bg-indigo-500"
                        : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                    title={`similarity ${sug.score.toFixed(2)}`}
                  >
                    {sug.topic_label}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
