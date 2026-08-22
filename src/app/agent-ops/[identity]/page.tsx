import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { AgentPrompt, AgentPromptVersion } from "@/lib/agentOps";
import AgentBriefEditor from "../AgentBriefEditor";
import styles from "../agentOps.module.css";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ identity: string }> }) {
  const { identity: raw } = await params;
  const identity = decodeURIComponent(raw);

  const [promptRes, registryRes, versionsRes] = await Promise.all([
    supabase.from("agent_prompts").select("*").eq("identity", identity).maybeSingle(),
    supabase.from("agent_registry").select("agent_name, role, status, last_heartbeat_at").eq("agent_name", identity).maybeSingle(),
    supabase
      .from("agent_prompt_versions")
      .select("*")
      .eq("identity", identity)
      .order("version", { ascending: false }),
  ]);
  if (promptRes.error) throw new Error(promptRes.error.message);
  if (registryRes.error) throw new Error(registryRes.error.message);
  if (versionsRes.error) throw new Error(versionsRes.error.message);

  const registry = registryRes.data as { agent_name: string; role: string } | null;
  if (!registry) notFound();

  const prompt = promptRes.data as AgentPrompt | null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/agent-ops" className={styles.back}>
          ← Agent Ops
        </Link>
        <h1>{registry.agent_name}</h1>
        <p>{registry.role}</p>
      </div>

      {prompt ? (
        <AgentBriefEditor
          identity={identity}
          role={registry.role}
          initialPrompt={prompt}
          initialVersions={(versionsRes.data ?? []) as AgentPromptVersion[]}
        />
      ) : (
        <div className={styles.card}>
          <p className={styles.empty}>
            This agent is registered but has no brief row yet. Seed <code>agent_prompts</code> for{" "}
            <code>{identity}</code> and it will show up here.
          </p>
        </div>
      )}
    </div>
  );
}
