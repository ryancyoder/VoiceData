import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  PROMPT_COLUMNS,
  VERSION_COLUMNS,
  type AgentPrompt,
  type AgentPromptVersion,
} from "@/lib/agentPrompts";
import AgentBriefEditor from "./AgentBriefEditor";

// One agent's brief, editable. Saving writes the row and the database trigger
// snapshots it — so Ryan never has to log into Supabase to change a rule.
export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ identity: string }>;
}) {
  const { identity } = await params;

  const [promptRes, registryRes] = await Promise.all([
    supabase.from("agent_prompts").select(PROMPT_COLUMNS).eq("identity", identity).maybeSingle(),
    supabase.from("agent_registry").select("agent_name, role, status, last_heartbeat_at").eq("agent_name", identity).maybeSingle(),
  ]);
  if (promptRes.error) throw new Error(promptRes.error.message);
  if (registryRes.error) throw new Error(registryRes.error.message);
  if (!promptRes.data) notFound();

  const prompt = promptRes.data as unknown as AgentPrompt;
  const registry = registryRes.data as { role: string; status: string } | null;

  const versionsRes = await supabase
    .from("agent_prompt_versions")
    .select(VERSION_COLUMNS)
    .eq("prompt_id", prompt.id)
    .order("version", { ascending: false });
  if (versionsRes.error) throw new Error(versionsRes.error.message);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-6">
        <Link
          href="/agent-ops"
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Agent Ops
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {prompt.identity}
        </h1>
        {registry?.role ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{registry.role}</p>
        ) : null}
      </header>

      <AgentBriefEditor
        prompt={prompt}
        versions={(versionsRes.data ?? []) as unknown as AgentPromptVersion[]}
      />
    </main>
  );
}
