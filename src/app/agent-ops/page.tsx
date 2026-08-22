import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { formatWhen, type AgentOpsStatus, type AgentPrompt } from "@/lib/agentOps";
import styles from "./agent-ops.module.css";

// The Agent Ops console: one tile per agent. Tap a tile to read and edit that
// agent's brief. Nothing here is meant to send Ryan into Supabase to hand-edit
// a table from his phone — every rule in the system is editable on the detail
// screen behind these tiles.
export const dynamic = "force-dynamic";

type PromptSummary = Pick<AgentPrompt, "identity" | "version" | "mandate" | "updated_at" | "updated_by">;

export default async function AgentOpsPage() {
  const [statusRes, promptsRes, queueRes] = await Promise.all([
    supabase.from("agent_ops_status").select("*").order("agent_name"),
    supabase.from("agent_prompts").select("identity, version, mandate, updated_at, updated_by"),
    supabase.from("agent_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  if (statusRes.error) throw new Error(`Failed to load Agent Ops: ${statusRes.error.message}`);
  if (promptsRes.error) throw new Error(`Failed to load agent briefs: ${promptsRes.error.message}`);

  const agents = (statusRes.data ?? []) as AgentOpsStatus[];
  const prompts = new Map((promptsRes.data ?? []).map((p) => [(p as PromptSummary).identity, p as PromptSummary]));
  const pending = queueRes.count ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Agent Ops</h1>
        <p>
          Seven agents, one bus. They never call each other — each one claims a queue row addressed to it, does the
          work, marks it complete, and enqueues follow-ups. Tap an agent to read or edit its brief; the change is live
          on that agent&rsquo;s next session, with no redeploy.
        </p>
      </div>

      <div className={styles.summary}>
        <span>
          <strong>{agents.length}</strong> agents
        </span>
        <span>
          <strong>{pending}</strong> queued
        </span>
        <span>
          <strong>{agents.filter((a) => a.failed > 0).length}</strong> with failures
        </span>
      </div>

      <div className={styles.tiles}>
        {agents.map((agent) => {
          const prompt = prompts.get(agent.agent_name);
          return (
            <Link key={agent.agent_name} href={`/agent-ops/${agent.agent_name}`} className={styles.tile}>
              <div className={styles.tileHead}>
                <h2>{agent.agent_name}</h2>
                <span className={`${styles.dot} ${agent.stale ? styles.dotStale : styles.dotLive}`} aria-hidden />
              </div>
              <p className={styles.role}>{agent.role}</p>

              {prompt ? (
                <p className={styles.mandate}>{prompt.mandate}</p>
              ) : (
                <p className={styles.noBrief}>No brief yet — this agent has nothing to load.</p>
              )}

              <div className={styles.counts}>
                <span className={agent.queued ? styles.countOn : undefined}>{agent.queued} queued</span>
                <span className={agent.in_flight ? styles.countOn : undefined}>{agent.in_flight} in flight</span>
                <span className={agent.failed ? styles.countBad : undefined}>{agent.failed} failed</span>
              </div>

              <div className={styles.meta}>
                <span>{prompt ? `Brief v${prompt.version}` : "No brief"}</span>
                <span>
                  {agent.status} · heartbeat {formatWhen(agent.last_heartbeat_at)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {!agents.length && (
        <p className={styles.empty}>
          No agents registered. Add a row to <code>agent_registry</code> first — a brief hangs off it.
        </p>
      )}
    </div>
  );
}
