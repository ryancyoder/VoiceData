import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgentPrompt, getAgentStatus, listPromptVersions } from "@/lib/agentOps";
import AgentBriefEditor from "./AgentBriefEditor";

// One agent's detail view: its brief in editable fields. Saving writes the row
// back and snapshots the previous version, so a bad edit can be diffed and
// rolled back rather than lost.
export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  const identity = decodeURIComponent(agent);

  const [status, prompt] = await Promise.all([getAgentStatus(identity), getAgentPrompt(identity)]);
  if (!status && !prompt) notFound();

  const versions = prompt ? await listPromptVersions(prompt.id) : [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link href="/agent-ops" className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          ← Agent Ops
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{identity}</h1>
        {status && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{status.role}</p>}
        {status && (
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{status.queued} queued</span>
            <span>{status.in_flight} in flight</span>
            <span className={Number(status.failed) > 0 ? "font-medium text-red-600 dark:text-red-400" : undefined}>
              {status.failed} failed
            </span>
            <span>{status.done_24h} done / 24h</span>
          </div>
        )}
      </header>

      <AgentBriefEditor identity={identity} prompt={prompt} versions={versions} />
    </main>
  );
}
