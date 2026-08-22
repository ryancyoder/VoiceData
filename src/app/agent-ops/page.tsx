import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import type { AgentStatus } from "@/lib/agentOps";
import styles from "./agentOps.module.css";

export const dynamic = "force-dynamic";

interface PromptMeta {
  identity: string;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

function ago(ts: string | null): string {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (!Number.isFinite(mins)) return "never";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function AgentOpsPage() {
  const [statusRes, promptRes] = await Promise.all([
    supabase.from("agent_ops_status").select("*").order("agent_name"),
    supabase.from("agent_prompts").select("identity, version, updated_at, updated_by"),
  ]);
  if (statusRes.error) throw new Error(`Failed to load agents: ${statusRes.error.message}`);
  if (promptRes.error) throw new Error(`Failed to load briefs: ${promptRes.error.message}`);

  const agents = (statusRes.data ?? []) as AgentStatus[];
  const briefs = new Map<string, PromptMeta>(
    ((promptRes.data ?? []) as PromptMeta[]).map((p) => [p.identity, p])
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Agent Ops</h1>
        <p>
          Every agent&apos;s brief lives here, not in a file on a laptop. Tap an agent to read or change the
          rules it runs on — the change takes effect on its next session, with no redeploy.
        </p>
      </div>

      <div className={styles.tiles}>
        {agents.map((agent) => {
          const brief = briefs.get(agent.agent_name);
          return (
            <Link key={agent.agent_name} href={`/agent-ops/${agent.agent_name}`} className={styles.tile}>
              <div className={styles.tileHead}>
                <span className={styles.tileName}>{agent.agent_name}</span>
                <span className={agent.stale ? styles.dotStale : styles.dotLive} aria-hidden />
              </div>
              <p className={styles.tileRole}>{agent.role}</p>
              <div className={styles.counts}>
                <span>{agent.queued} queued</span>
                <span>{agent.in_flight} in flight</span>
                <span className={agent.failed > 0 ? styles.bad : undefined}>{agent.failed} failed</span>
              </div>
              <div className={styles.tileFoot}>
                {brief ? `Brief v${brief.version} · edited ${ago(brief.updated_at)}` : "No brief yet"}
                <span> · heartbeat {ago(agent.last_heartbeat_at)}</span>
              </div>
            </Link>
          );
        })}
        {agents.length === 0 && <p className={styles.empty}>No agents registered.</p>}
      </div>
    </div>
  );
}
