import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

// Agent Ops console. One tile per agent: is it alive, what is waiting for it,
// and a way into its brief. Tap a tile to read and edit what that agent is.
export const dynamic = "force-dynamic";

interface StatusRow {
  agent_name: string;
  role: string;
  status: string;
  last_heartbeat_at: string | null;
  last_run_at: string | null;
  stale: boolean;
  queued: number;
  in_flight: number;
  failed: number;
  done_24h: number;
  oldest_pending_at: string | null;
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function AgentOpsPage() {
  const [statusRes, promptsRes] = await Promise.all([
    supabase.from("agent_ops_status").select("*").order("agent_name"),
    supabase.from("agent_prompts").select("identity, version, updated_at"),
  ]);
  if (statusRes.error) throw new Error(statusRes.error.message);
  if (promptsRes.error) throw new Error(promptsRes.error.message);

  const agents = (statusRes.data ?? []) as StatusRow[];
  const briefs = new Map(
    ((promptsRes.data ?? []) as { identity: string; version: number; updated_at: string }[]).map(
      (b) => [b.identity, b]
    )
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Agent Ops</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The agents coordinate only through Supabase rows — each one claims work addressed to it, does it, and
          enqueues follow-ups. Tap an agent to edit its brief; it picks up the change on its next session.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => {
          const brief = briefs.get(agent.agent_name);
          return (
            <li key={agent.agent_name}>
              <Link
                href={`/agent-ops/${agent.agent_name}`}
                className="block rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{agent.agent_name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      agent.status === "error"
                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : agent.stale
                          ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    }`}
                  >
                    {agent.status === "error" ? "error" : agent.stale ? "idle" : agent.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{agent.role}</p>

                <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <div className="flex gap-1">
                    <dt>queued</dt>
                    <dd className="font-medium text-zinc-700 dark:text-zinc-200">{agent.queued}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>in flight</dt>
                    <dd className="font-medium text-zinc-700 dark:text-zinc-200">{agent.in_flight}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>failed</dt>
                    <dd
                      className={
                        agent.failed > 0
                          ? "font-medium text-red-600 dark:text-red-400"
                          : "font-medium text-zinc-700 dark:text-zinc-200"
                      }
                    >
                      {agent.failed}
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>seen</dt>
                    <dd className="font-medium text-zinc-700 dark:text-zinc-200">
                      {relative(agent.last_heartbeat_at)}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                  {brief ? `Brief v${brief.version} · edited ${relative(brief.updated_at)}` : "No brief yet"}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
