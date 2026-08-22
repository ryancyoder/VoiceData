import Link from "next/link";
import { listAgentPrompts, listAgentStatus } from "@/lib/agentOps";

// The Agent Ops console. One tile per registered agent; tap through to its
// brief. Ryan should never be logging into Supabase to hand-edit these tables
// from his phone — every rule in this system is editable from here.
export const dynamic = "force-dynamic";

function fmt(ts: string | null): string {
  if (!ts) return "never";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "never";
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function ago(ts: string | null): string {
  if (!ts) return "";
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (!isFinite(mins) || mins < 0) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function AgentOpsPage() {
  const [status, prompts] = await Promise.all([listAgentStatus(), listAgentPrompts()]);
  const briefByAgent = new Map(prompts.map((p) => [p.identity, p]));

  const totals = status.reduce(
    (acc, s) => ({
      queued: acc.queued + Number(s.queued ?? 0),
      in_flight: acc.in_flight + Number(s.in_flight ?? 0),
      failed: acc.failed + Number(s.failed ?? 0),
    }),
    { queued: 0, in_flight: 0, failed: 0 }
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Agent Ops</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Agents never call each other — they coordinate through the queue. Tap an agent to read or edit its brief;
          changes are picked up on its next session, with no redeploy.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {totals.queued} queued
          </span>
          <span className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            {totals.in_flight} in flight
          </span>
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              totals.failed
                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {totals.failed} failed
          </span>
        </div>
      </header>

      {status.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No agents registered yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {status.map((s) => {
            const brief = briefByAgent.get(s.agent_name);
            return (
              <Link
                key={s.agent_name}
                href={`/agent-ops/${encodeURIComponent(s.agent_name)}`}
                className="block rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{s.agent_name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      s.stale
                        ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    }`}
                    title={`Last heartbeat: ${fmt(s.last_heartbeat_at)}`}
                  >
                    {s.stale ? "idle" : s.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.role}</p>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{s.queued} queued</span>
                  <span>{s.in_flight} in flight</span>
                  <span className={Number(s.failed) > 0 ? "font-medium text-red-600 dark:text-red-400" : undefined}>
                    {s.failed} failed
                  </span>
                  <span>{s.done_24h} done / 24h</span>
                </div>

                <div className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                  {brief ? (
                    <>
                      Brief v{brief.version} · edited {ago(brief.updated_at) || fmt(brief.updated_at)}
                    </>
                  ) : (
                    <span className="font-medium text-amber-600 dark:text-amber-400">No brief yet — tap to write one</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
