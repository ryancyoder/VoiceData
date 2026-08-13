import { supabase } from "@/lib/supabaseClient";

// Read-only viewer for VoiceMap data synced into Supabase. VoiceMap (the PWA)
// pushes its sessions + cards through /api/voicemap/sync; this page renders them
// so the brainstorming data is visible from inside VoiceData.
export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  name: string | null;
  date: string | null;
  meta: { synced?: string } | null;
  updated_at: string | null;
}
interface NodeRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  label: string | null;
  summary: string | null;
  status: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  locked: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  refined: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  in_progress: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// Render a card and its descendants. `seen` guards against circular parent_id
// chains (VoiceMap repairs these, but a viewer must never infinite-loop).
function CardTree({
  parentId,
  byParent,
  seen,
}: {
  parentId: string | null;
  byParent: Map<string | null, NodeRow[]>;
  seen: Set<string>;
}) {
  const children = byParent.get(parentId) ?? [];
  if (!children.length) return null;
  return (
    <ul className={parentId === null ? "space-y-2" : "mt-2 space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800"}>
      {children.map((node) => {
        if (seen.has(node.id)) return null;
        const nextSeen = new Set(seen);
        nextSeen.add(node.id);
        const status = (node.status ?? "").toLowerCase();
        return (
          <li key={node.id}>
            <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {node.label || "(untitled)"}
                </span>
                {status && status !== "untouched" && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      STATUS_STYLES[status] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {status.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              {node.summary && (
                <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{node.summary}</p>
              )}
            </div>
            <CardTree parentId={node.id} byParent={byParent} seen={nextSeen} />
          </li>
        );
      })}
    </ul>
  );
}

export default async function VoiceMapPage() {
  const [sessionsRes, nodesRes] = await Promise.all([
    supabase.from("voicemap_sessions").select("*").order("updated_at", { ascending: false }),
    supabase
      .from("voicemap_nodes")
      .select("id, session_id, parent_id, label, summary, status")
      .order("last_modified", { ascending: true }),
  ]);

  if (sessionsRes.error) throw new Error(`Failed to load VoiceMap sessions: ${sessionsRes.error.message}`);
  if (nodesRes.error) throw new Error(`Failed to load VoiceMap cards: ${nodesRes.error.message}`);

  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  const nodes = (nodesRes.data ?? []) as NodeRow[];

  const nodesBySession = new Map<string, NodeRow[]>();
  for (const n of nodes) {
    const list = nodesBySession.get(n.session_id) ?? [];
    list.push(n);
    nodesBySession.set(n.session_id, list);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">VoiceMap</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Read-only view of ideas captured in the VoiceMap app.
        </p>
      </header>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No VoiceMap data yet. Connect the VoiceMap app to this project&apos;s{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">/api/voicemap/sync</code> endpoint and sync a
          session.
        </div>
      ) : (
        <div className="space-y-8">
          {sessions.map((session) => {
            const sessionNodes = nodesBySession.get(session.id) ?? [];
            const byParent = new Map<string | null, NodeRow[]>();
            const ids = new Set(sessionNodes.map((n) => n.id));
            for (const n of sessionNodes) {
              // Treat cards whose parent is missing as roots so nothing is hidden.
              const key = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
              const list = byParent.get(key) ?? [];
              list.push(n);
              byParent.set(key, list);
            }
            return (
              <section key={session.id}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
                    {session.name || "Untitled session"}
                  </h2>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                    {sessionNodes.length} card{sessionNodes.length === 1 ? "" : "s"}
                    {session.meta?.synced ? ` · synced ${fmt(session.meta.synced)}` : ""}
                  </span>
                </div>
                {sessionNodes.length === 0 ? (
                  <p className="text-sm text-zinc-400 dark:text-zinc-500">No cards.</p>
                ) : (
                  <CardTree parentId={null} byParent={byParent} seen={new Set()} />
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
